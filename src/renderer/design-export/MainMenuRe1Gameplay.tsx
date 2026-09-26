import svgPaths from "./svg-rzwuogcawc";
import imgAnnieSprattKGZwDuQ8MeUnsplash1 from "figma:asset/e6746d9b64d4f1fe99adc0b88f3edf7822719e12.png";
import imgImage16 from "figma:asset/6b9a2a4e71fbacbbc6a27673c927df64c2a179a0.png";
import imgImg from "figma:asset/4e4dca1d6a087479654cb2498612efc7376dd481.png";
import imgLogo from "figma:asset/9b6e0e65ba185590981bf00e804ba7d696a9dd40.png";
import { imgImage15 } from "./svg-m31k7";

function Img() {
  return (
    <div className="absolute inset-0 rounded-[2px]" data-name="IMG">
      <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[2px]">
        <img alt="" className="absolute h-[107.28%] left-[-0.05%] max-w-none top-[-3.78%] w-[100.1%]" src={imgImg} />
      </div>
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
      <div className="-translate-y-1/2 absolute h-[1080px] overflow-clip right-[-293px] top-1/2 w-[999px]" data-name="game">
        <div className="absolute aspect-[1218.7529296875/1445.560546875] left-0 mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[0px_109.943px] mask-size-[1068px_1080px] right-0 top-[-109.94px]" data-name="image 15" style={{ maskImage: `url('${imgImage15}')` }}>
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <img alt="" className="absolute h-[163.67%] left-[-20.62%] max-w-none top-[-27.26%] w-[120.62%]" src={imgImage16} />
          </div>
        </div>
        <div className="-translate-x-1/2 -translate-y-1/2 absolute h-[925.377px] left-1/2 mask-alpha mask-intersect mask-no-clip mask-no-repeat mask-position-[-19.902px_-77.623px] mask-size-[1068px_1080px] top-[calc(50%+0.31px)] w-[1028.197px]" data-name="overlay" style={{ maskImage: `url('${imgImage15}')` }}>
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
      <div className="-translate-y-1/2 absolute flex h-[516.266px] items-center justify-center left-[73.11px] top-[calc(50%-1.13px)] w-[137.574px]" style={{ "--transform-inner-width": "1200", "--transform-inner-height": "21" } as React.CSSProperties}>
        <div className="-rotate-90 flex-none">
          <div className="h-[137.574px] relative w-[516.266px]" data-name="logo">
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

export default function MainMenuRe1Gameplay() {
  return (
    <div className="bg-[#0f0f0f] content-stretch flex gap-[10px] items-start relative size-full" data-name="Main Menu / RE 1 / Gameplay">
      <Body />
    </div>
  );
}