/**
 * CRT post-processing overlay.
 *
 * The Figma concept contains no CRT surface at all -- the frame is a fixed
 * 1920x1080 canvas of flat #0F0F0F (data/design.ts CANVAS) -- so every value
 * here comes from the implementation this port replaces rather than from the
 * design:
 *
 *   `git show HEAD:assets/shaders/crt.frag`        scanline, grain, barrel warp
 *   `git show HEAD:src/renderer/crt_filter.cpp`    the uniforms behind them
 *
 * Those uniforms are the LauncherConfig fields in @shared/types
 * (`scanlineIntensity`, `curvature`, `crtGrain`) whose defaults are recorded in
 * data/design.ts CRT_DEFAULTS, so the DOM layers below are the cheapest faithful
 * equivalent of each one:
 *
 *   scanlines  repeating-linear-gradient, one dark band every 2 device pixels,
 *              which is the period of the shader's `sin(uv.y * res.y * PI)`
 *   phosphor   a finer perpendicular gradient; the shader approximated its
 *              phosphor glow with a 4-tap blur (`uPhosphorGlow`), which has no
 *              cheap DOM counterpart
 *   vignette   radial-gradient from `crtVignette` (a config.ini key with no
 *              shader counterpart, so only its strength is defined)
 *   grain      inline `feTurbulence`, jittered by a CSS keyframe
 *   curvature  `feDisplacementMap` driven by a radial falloff
 *
 * The layer order follows the shader: warp the picture, then scanlines, then
 * phosphor, then vignette, then noise on top. The whole stack is
 * `pointer-events-none` and never participates in layout.
 */
import { useId } from 'react'
import type { CrtOverlayProps } from '@renderer/contracts'
import { CANVAS } from '@renderer/data/design'

/**
 * The legacy scanline is `sin(uv.y * resolution.y * PI)`, i.e. exactly one dark
 * band per two device pixels (`crt.frag`), which the gradient below reproduces
 * with a 1px dark half and a 1px clear half.
 */
const SCANLINE_PERIOD_PX = 2

/** The phosphor mask is finer than the scanlines and never fully opaque. */
const PHOSPHOR_PERIOD_PX = 3
const PHOSPHOR_ALPHA = 0.08

/** Flat, undarkened centre of both the vignette and the warp falloff, in percent. */
const VIGNETTE_FLAT_PERCENT = 55

/**
 * `curvature` -> `feDisplacementMap` scale, expressed as a fraction of the stage
 * width so it survives any window size. At the design default of 0.08 this is
 * ~26px of edge displacement on the 1920px stage.
 *
 * The shader warped its own low-resolution offscreen framebuffer by
 * `cc * (1 + k * r * 4)`; at k=0.08 that moved the mid-edge by ~77px, which is
 * tolerable for a blurred 3D render and unreadable for DOM text, so this keeps
 * the shader's *shape* -- unmoved centre, edges bending outward -- at roughly a
 * third of its strength.
 */
const CURVATURE_TO_STAGE = 320 / CANVAS.width

/** Clamps an externally supplied 0..1 intensity; NaN and out-of-range fall back to off. */
function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/** Same, for the unbounded `curvature` (config.ini values are not range-checked on import). */
function clampPositive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/** `feImage` needs a real URL, so the two ramps and the falloff live as data URIs. */
function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Black at the left edge to white at the right: the x half of the displacement field. */
const RAMP_X = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">' +
    '<linearGradient id="ramp" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/>' +
    '</linearGradient>' +
    '<rect width="1920" height="1080" fill="url(#ramp)"/></svg>'
)

/** The same ramp, top to bottom: the y half of the field. */
const RAMP_Y = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">' +
    '<linearGradient id="ramp" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/>' +
    '</linearGradient>' +
    '<rect width="1920" height="1080" fill="url(#ramp)"/></svg>'
)

/**
 * Radial falloff: zero (no displacement) out to VIGNETTE_FLAT_PERCENT of the
 * radius, then rising to full at the frame edge. `r="0.5"` in objectBoundingBox
 * units makes this an ellipse that touches all four edges and pads out to white
 * at the corners.
 */
const RADIAL_FALLOFF = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">' +
    '<radialGradient id="falloff" cx="0.5" cy="0.5" r="0.5">' +
    '<stop offset="0" stop-color="#000000"/>' +
    `<stop offset="${VIGNETTE_FLAT_PERCENT}%" stop-color="#000000"/>` +
    '<stop offset="1" stop-color="#ffffff"/>' +
    '</radialGradient>' +
    '<rect width="1920" height="1080" fill="url(#falloff)"/></svg>'
)

/**
 * Grain needs to change every refresh to read as grain, and the shader got that
 * for free by hashing `uTime` into its noise (`crt.frag`). A DOM noise field
 * cannot be re-seeded, so the layer is oversized and stepped through a few
 * offsets instead: the field is static, but the part of it landing on any given
 * pixel keeps changing, which is what the eye reads as animated grain.
 *
 * The keyframes are injected by the component because it owns no stylesheet.
 */
function grainKeyframes(name: string): string {
  return [
    `@keyframes ${name}{`,
    '0%{transform:translate3d(-2.5%,-1.5%,0)}',
    '25%{transform:translate3d(1.5%,-3%,0)}',
    '50%{transform:translate3d(-3%,2%,0)}',
    '75%{transform:translate3d(2.5%,1%,0)}',
    '100%{transform:translate3d(-2.5%,-1.5%,0)}}',
    // steps(1, end) snaps between keyframes so the noise jumps instead of sliding.
    `.${name}{animation:${name} 900ms steps(1,end) infinite}`
  ].join('')
}

export function CrtOverlay({ config }: CrtOverlayProps) {
  const rawId = useId()
  // `useId` returns something like `:r0:` or `«r0»`, and neither a colon nor a
  // guillemet is legal in a CSS identifier or an SVG `url(#...)` reference, so
  // the generated names are stripped down to safe characters first.
  const id = `crt-${rawId.replace(/[^A-Za-z0-9_-]/g, '')}`

  if (!config.crtEnabled) return null

  const scanline = clamp01(config.scanlineIntensity)
  const vignette = clamp01(config.crtVignette)
  const grain = clamp01(config.crtGrain)
  const warpScale = clampPositive(config.curvature) * CURVATURE_TO_STAGE

  const grainFilterId = `${id}-grain`
  const warpFilterId = `${id}-warp`
  const grainAnimation = `${id}-grain-drift`

  const scanlineGradient =
    `repeating-linear-gradient(to bottom, rgba(0, 0, 0, ${scanline}) 0px, ` +
    `rgba(0, 0, 0, ${scanline}) ${SCANLINE_PERIOD_PX / 2}px, rgba(0, 0, 0, 0) ${
      SCANLINE_PERIOD_PX / 2
    }px, rgba(0, 0, 0, 0) ${SCANLINE_PERIOD_PX}px)`

  const phosphorGradient =
    `repeating-linear-gradient(to right, rgba(0, 0, 0, ${PHOSPHOR_ALPHA}) 0px, ` +
    `rgba(0, 0, 0, ${PHOSPHOR_ALPHA}) 1px, rgba(0, 0, 0, 0) 1px, ` +
    `rgba(0, 0, 0, 0) ${PHOSPHOR_PERIOD_PX}px)`

  const vignetteGradient =
    `radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, 0) ${VIGNETTE_FLAT_PERCENT}%, ` +
    `rgba(0, 0, 0, ${vignette}) 100%)`

  return (
    <div
      aria-hidden="true"
      data-crt-overlay="true"
      // `fixed`, not `absolute`: the stage scales its 1920x1080 author space with
      // a transform, and a transform makes that element the containing block for
      // fixed descendants, so this still tracks the stage -- and it keeps
      // covering the window if the stage is ever unscaled.
      className="pointer-events-none fixed inset-0 z-[100] overflow-hidden"
    >
      <style>{grainKeyframes(grainAnimation)}</style>

      {/*
        Filter definitions. A zero-sized SVG is the canonical way to publish
        filters to HTML elements without painting anything of its own.
      */}
      <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute size-0">
        <defs>
          <filter id={grainFilterId} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
            {/*
              Contrast-stretch `3 * c - 1`, so the noise collapses to black and
              white specks instead of hovering around mid-grey. That is what lets
              the layer composite normally and still behave like the shader's
              mean-zero `col += grain * uNoiseAmount`: dark specks darken, bright
              specks lighten, and nothing lifts the black level. A blend mode
              could not do this job here anyway -- the fixed wrapper below is a
              stacking context, so a child's blend mode only ever sees the
              overlay's own transparent layers, never the screen behind it.
            */}
            <feColorMatrix
              type="matrix"
              values="3 0 0 0 -1 0 3 0 0 -1 0 0 3 0 -1 0 0 0 1 0"
            />
          </filter>

          {warpScale > 0 ? (
            /*
              Barrel curvature, intentionally approximate. The shader displaced
              each colour channel of its own framebuffer by a different amount
              (`uRGBSplit`), and reproducing that chromatic aberration on live DOM
              content would mean three full-stage filters per frame -- prohibitively
              expensive and ruinous for text rendering. This warps the overlay's
              glass layers as a single image instead: same shape, no per-channel
              split. `primitiveUnits="objectBoundingBox"` keeps the ramps and the
              displacement proportional to the stage at any window size; the exact
              factor browsers derive from the reference box for relative
              displacement units is not identical across engines, so the strength
              is tuned to stay subtle under any of them.
            */
            <filter
              id={warpFilterId}
              primitiveUnits="objectBoundingBox"
              colorInterpolationFilters="sRGB"
            >
              <feImage
                href={RAMP_X}
                x="0"
                y="0"
                width="1"
                height="1"
                preserveAspectRatio="none"
                result="rampX"
              />
              <feImage
                href={RAMP_Y}
                x="0"
                y="0"
                width="1"
                height="1"
                preserveAspectRatio="none"
                result="rampY"
              />
              <feImage
                href={RADIAL_FALLOFF}
                x="0"
                y="0"
                width="1"
                height="1"
                preserveAspectRatio="none"
                result="falloff"
              />
              {/*
                (ramp - 0.5) * falloff + 0.5: re-centred on mid-grey so a channel
                of 0.5 means "leave this pixel alone". feDisplacementMap samples
                *outward* from each pixel, so the negative first coefficient is
                what pushes the frame edges away from the centre (barrel) instead
                of pulling them in (pincushion).
              */}
              <feComposite
                in="rampX"
                in2="falloff"
                operator="arithmetic"
                k1="-1"
                k2="0"
                k3="0.5"
                k4="0.5"
                result="shiftX"
              />
              <feComposite
                in="rampY"
                in2="falloff"
                operator="arithmetic"
                k1="-1"
                k2="0"
                k3="0.5"
                k4="0.5"
                result="shiftY"
              />
              {/* Pack the two axes into the channels the selectors below read.
                  Each `values` list is exactly 4 rows of 5: R gets shiftX's R,
                  G gets shiftY's R, and the alpha row is left at passthrough. */}
              <feColorMatrix
                in="shiftX"
                type="matrix"
                values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
                result="mapR"
              />
              <feColorMatrix
                in="shiftY"
                type="matrix"
                values="0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
                result="mapG"
              />
              <feComposite
                in="mapR"
                in2="mapG"
                operator="arithmetic"
                k2="1"
                k3="1"
                k4="0"
                result="warpMap"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="warpMap"
                scale={warpScale}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          ) : null}
        </defs>
      </svg>

      {/*
        The glass: scanlines, phosphor mask and vignette, warped together when
        curvature is on. Every one of these is an overlay of one colour at
        partial alpha, so none of them needs a blend mode; they darken what is
        underneath rather than tinting it.
      */}
      <div
        className="absolute inset-0"
        style={warpScale > 0 ? { filter: `url(#${warpFilterId})` } : undefined}
      >
        {scanline > 0 ? (
          <div className="absolute inset-0" style={{ backgroundImage: scanlineGradient }} />
        ) : null}
        <div className="absolute inset-0" style={{ backgroundImage: phosphorGradient }} />
        {vignette > 0 ? (
          <div className="absolute inset-0" style={{ backgroundImage: vignetteGradient }} />
        ) : null}
      </div>

      {/*
        Grain sits outside the warp on purpose: displacing a static noise field
        changes nothing the eye can see, and nesting a full-stage turbulence
        filter inside a displacement filter doubles the cost of the one part of
        this overlay that animates.
      */}
      {grain > 0 ? (
        <svg
          aria-hidden="true"
          className={`pointer-events-none absolute ${grainAnimation}`}
          // Oversized by 6% so the jitter keyframes can never expose an edge.
          style={{ inset: '-6%', width: '112%', height: '112%', opacity: grain }}
        >
          <rect x="0" y="0" width="100%" height="100%" filter={`url(#${grainFilterId})`} />
        </svg>
      ) : null}
    </div>
  )
}
