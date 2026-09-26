import svgPaths from "./svg-qu8fkxs1pe";
import imgAnnieSprattKGZwDuQ8MeUnsplash1 from "figma:asset/e6746d9b64d4f1fe99adc0b88f3edf7822719e12.png";
import imgImage18 from "figma:asset/8c48435db9d52dd5b04c9234227dd601baa2cbbf.png";
import imgLogo from "figma:asset/18fb9a00f28d573818b95bd7ae1d1ecab2df9883.png";
import { imgImage17 } from "./svg-bc4wo";

function Img() {
  return (
    <div className="absolute inset-0 rounded-[2px]" data-name="IMG">
      <video autoPlay className="absolute max-w-none object-cover rounded-[2px] size-full" controlsList="nodownload" loop playsInline>
        <source src="/_videos/v1/9b27cd2fbb6ab394b98b5915c2140751919c424b" />
      </video>
    </div>
  );
}

function Main() {
  return (
    <div className="absolute inset-[-0.1%_0_0_0]" data-name="main">
      <Img />
    </div>
  );
}

function GameFrame() {
  return (
    <div className="flex-[1_0_0] h-full min-h-px min-w-px relative" data-name="game frame">
      <div className="-translate-y-1/2 absolute h-[1080px] overflow-clip right-[-418px] top-1/2 w-[999px]" data-name="game">
        <div className="absolute aspect-[1016/1132] left-[-0.05%] mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[0.5px_0px] mask-size-[1068px_1080px] right-0 top-0" data-name="image 17" style={{ maskImage: `url('${imgImage17}')` }}>
          <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={imgImage18} />
        </div>
        <div className="-translate-x-1/2 -translate-y-1/2 absolute h-[925.377px] left-1/2 mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-19.902px_-77.623px] mask-size-[1068px_1080px] top-[calc(50%+0.31px)] w-[1028.197px]" data-name="overlay" style={{ maskImage: `url('${imgImage17}')` }}>
          <div className="absolute inset-[-98.66%_-88.8%]">
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 2854.2 2751.38">
              <g filter="url(#filter0_f_1_788)" id="overlay" opacity="0.91">
                <path d={svgPaths.p3470b00} stroke="var(--stroke-0, black)" strokeWidth="613" />
              </g>
              <defs>
                <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="2751.38" id="filter0_f_1_788" width="2854.2" x="0" y="0">
                  <feFlood floodOpacity="0" result="BackgroundImageFix" />
                  <feBlend in="SourceGraphic" in2="BackgroundImageFix" mode="normal" result="shape" />
                  <feGaussianBlur result="effect1_foregroundBlur_1_788" stdDeviation="150" />
                </filter>
              </defs>
            </svg>
          </div>
        </div>
      </div>
      <div className="-translate-x-1/2 absolute bg-white h-[975px] left-1/2 overflow-clip rounded-[4px] top-[45px] w-[1300px]" data-name="Gameplay 1">
        <Main />
      </div>
      <div className="-translate-y-1/2 absolute flex h-[543.803px] items-center justify-center left-[73px] top-1/2 w-[130px]" style={{ "--transform-inner-width": "1200", "--transform-inner-height": "21" } as React.CSSProperties}>
        <div className="-rotate-90 flex-none">
          <div className="h-[130px] relative w-[543.803px]" data-name="logo">
            <img alt="" className="absolute inset-0 max-w-none object-cover pointer-events-none size-full" src={imgLogo} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Body() {
  return (
    <div className="bg-[#010101] content-stretch flex flex-[1_0_0] h-full items-center justify-center min-h-px min-w-px relative" data-name="body">
      <div className="-translate-x-1/2 absolute bottom-[-40.23px] flex h-[1539.34px] items-center justify-center left-1/2 mix-blend-hard-light w-[1920px]">
        <div className="-scale-y-100 flex-none">
          <div className="h-[1539.34px] relative w-[1920px]" data-name="annie-spratt-kG-ZwDuQ8ME-unsplash 1">
            <img alt="" className="absolute inset-0 max-w-none object-cover opacity-10 pointer-events-none size-full" src={imgAnnieSprattKGZwDuQ8MeUnsplash1} />
          </div>
        </div>
      </div>
      <GameFrame />
    </div>
  );
}

export default function MainMenuRe2Gameplay() {
  return (
    <div className="bg-[#0f0f0f] content-stretch flex gap-[10px] items-start relative size-full" data-name="Main Menu / RE 2 / Gameplay">
      <Body />
    </div>
  );
}