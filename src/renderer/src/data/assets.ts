/**
 * Asset key -> bundled URL.
 *
 * The catalog (src/shared/catalog.ts) refers to art by stable keys such as
 * `game/hero-re1-us`; this module is the only place that knows which file that
 * is. All files are produced by `pnpm assets:sync`, which re-encodes the design
 * and `media/` art into WebP.
 */
import backdrop from '../assets/game/backdrop-unsplash.webp'
import badgeClassicCollection from '../assets/game/badge-classic-collection.webp'
import cardRe1 from '../assets/game/card-re1.webp'
import cardRe2 from '../assets/game/card-re2.webp'
import cardRe3 from '../assets/game/card-re3.webp'
import gameplayRe1 from '../assets/game/gameplay-re1.webp'
import gameplayRe3 from '../assets/game/gameplay-re3.webp'
import heroRe1Us from '../assets/game/hero-re1-us.webp'
import heroRe1Jp from '../assets/game/hero-re1-jp.webp'
import heroRe1Dc from '../assets/game/hero-re1-dc.webp'
import heroRe2Leon from '../assets/game/hero-re2-leon.webp'
import heroRe2Proto from '../assets/game/hero-re2-proto.webp'
import heroRe2Jp from '../assets/game/hero-re2-jp.webp'
import heroRe3Us from '../assets/game/hero-re3-us.webp'
import heroRe3Jp from '../assets/game/hero-re3-jp.webp'
import regionRe1Us from '../assets/game/region-re1-us.webp'
import regionRe1Jp from '../assets/game/region-re1-jp.webp'
import regionRe1Dc from '../assets/game/region-re1-dc.webp'
import regionRe2Leon from '../assets/game/region-re2-leon.webp'
import regionRe2Proto from '../assets/game/region-re2-proto.webp'
import regionRe2Jp from '../assets/game/region-re2-jp.webp'
import regionRe3Us from '../assets/game/region-re3-us.webp'
import regionRe3Jp from '../assets/game/region-re3-jp.webp'
import logoRe1Us from '../assets/game/logo-re1-us.webp'
import logoRe1Jp from '../assets/game/logo-re1-jp.webp'
import logoRe1Dc from '../assets/game/logo-re1-dc.webp'
import logoRe2Leon from '../assets/game/logo-re2-leon.webp'
import logoRe2Proto from '../assets/game/logo-re2-proto.webp'
import logoRe2Jp from '../assets/game/logo-re2-jp.webp'
import logoRe3Us from '../assets/game/logo-re3-us.webp'
import logoRe3Jp from '../assets/game/logo-re3-jp.webp'

import videoRe1 from '../assets/video/video-re1.mp4'
import videoRe1Jp from '../assets/video/video-re1-jp.mp4'
import videoRe2 from '../assets/video/video-re2.mp4'
import videoRe2Jp from '../assets/video/video-re2-jp.mp4'
import videoRe3 from '../assets/video/video-re3.mp4'
import videoRe3Jp from '../assets/video/video-re3-jp.mp4'

import sfxConfirm from '../assets/audio/confirm.wav'
import sfxBack from '../assets/audio/back.wav'
import sfxCursor from '../assets/audio/cursor.wav'

import actorFont from '../assets/font/Actor-Regular.ttf'

export const ASSET_URLS: Record<string, string> = {
  'game/backdrop-unsplash': backdrop,
  // The main-menu badge, cropped from the concept's own lockup texture by
  // `pnpm assets:sync` (see BADGE_ART in data/design.ts).
  'game/badge-classic-collection': badgeClassicCollection,
  'game/card-re1': cardRe1,
  'game/card-re2': cardRe2,
  'game/card-re3': cardRe3,
  'game/gameplay-re1': gameplayRe1,
  'game/gameplay-re3': gameplayRe3,

  'game/hero-re1-us': heroRe1Us,
  'game/hero-re1-jp': heroRe1Jp,
  'game/hero-re1-dc': heroRe1Dc,
  'game/hero-re2-leon': heroRe2Leon,
  'game/hero-re2-proto': heroRe2Proto,
  'game/hero-re2-jp': heroRe2Jp,
  'game/hero-re3-us': heroRe3Us,
  'game/hero-re3-jp': heroRe3Jp,

  'game/region-re1-us': regionRe1Us,
  'game/region-re1-jp': regionRe1Jp,
  'game/region-re1-dc': regionRe1Dc,
  'game/region-re2-leon': regionRe2Leon,
  'game/region-re2-proto': regionRe2Proto,
  'game/region-re2-jp': regionRe2Jp,
  'game/region-re3-us': regionRe3Us,
  'game/region-re3-jp': regionRe3Jp,

  'game/logo-re1-us': logoRe1Us,
  'game/logo-re1-jp': logoRe1Jp,
  'game/logo-re1-dc': logoRe1Dc,
  'game/logo-re2-leon': logoRe2Leon,
  'game/logo-re2-proto': logoRe2Proto,
  'game/logo-re2-jp': logoRe2Jp,
  'game/logo-re3-us': logoRe3Us,
  'game/logo-re3-jp': logoRe3Jp,

  'video/video-re1': videoRe1,
  'video/video-re1-jp': videoRe1Jp,
  'video/video-re2': videoRe2,
  'video/video-re2-jp': videoRe2Jp,
  'video/video-re3': videoRe3,
  'video/video-re3-jp': videoRe3Jp
}

export const SFX_URLS = {
  confirm: sfxConfirm,
  back: sfxBack,
  cursor: sfxCursor
} as const

export const ACTOR_FONT_URL = actorFont

/** Resolves a catalog asset key; returns '' so callers can fall back gracefully. */
export function assetUrl(key: string | undefined | null): string {
  if (!key) return ''
  return ASSET_URLS[key] ?? ''
}
