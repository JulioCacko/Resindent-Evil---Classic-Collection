import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import svgPaths from "../../imports/svg-2gfz0znw1n";
import imgAnnieSprattKGZwDuQ8MeUnsplash1 from "figma:asset/e6746d9b64d4f1fe99adc0b88f3edf7822719e12.png";
import imgImageMain from "figma:asset/ecc806a21aeffd027d985a3da9ff383c45871820.png";
import imgImageMain1 from "figma:asset/541c500672b5c6658760e12f28531a7b2b01f3f7.png";
import imgRe3 from "figma:asset/5aa35917a70c6c21e8e6cb31cc8d7918f96df093.png";

const games = [
  { id: "re1", img: imgImageMain, label: "Resident Evil" },
  { id: "re2", img: imgImageMain1, label: "Resident Evil 2" },
  { id: "re3", img: imgRe3, label: "Resident Evil 3", rounded: true },
];

export default function MainMenuPage() {
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();

  const handleConfirm = useCallback(() => {
    navigate(`/${games[selected].id}`);
  }, [selected, navigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setSelected((s) => Math.max(0, s - 1));
      if (e.key === "ArrowRight") setSelected((s) => Math.min(2, s + 1));
      if (e.key === "Enter") handleConfirm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleConfirm]);

  return (
    <div className="bg-[#0f0f0f] relative size-full">
      <div className="-translate-x-1/2 -translate-y-1/2 absolute flex h-[1539.34px] items-center justify-center left-1/2 mix-blend-hard-light top-1/2 w-[1920px]">
        <div className="-scale-y-100 flex-none">
          <div className="h-[1539.34px] relative w-[1920px]">
            <img alt="" className="absolute inset-0 max-w-none object-cover opacity-20 pointer-events-none size-full" src={imgAnnieSprattKGZwDuQ8MeUnsplash1} />
          </div>
        </div>
      </div>
      <div className="absolute content-stretch flex h-[1080px] items-start left-0 top-0 w-[1920px]">
        <div className="flex-[1_0_0] h-full min-h-px min-w-px relative">
          <div className="flex flex-col justify-center size-full">
            <div className="content-stretch flex flex-col items-start justify-center pb-[72px] pt-[56px] px-[32px] relative size-full">
              <div className="content-stretch flex flex-[1_0_0] flex-col gap-[32px] items-center min-h-px min-w-px relative w-full">
                {/* Logo */}
                <div className="h-[250px] relative shrink-0 w-[625.021px]">
                  <div className="absolute content-stretch flex inset-[73.96%_7.57%_0_7.52%] items-center justify-center overflow-clip py-[7.776px] rounded-[4.786px] shadow-[0px_1.944px_0px_0px_#434343,0px_3.888px_0px_0px_rgba(0,0,0,0.4)]">
                    <div aria-hidden="true" className="absolute inset-0 pointer-events-none rounded-[4.786px]">
                      <div className="absolute bg-[#7f828a] inset-0 rounded-[4.786px]" />
                      <div className="absolute inset-0 mix-blend-overlay rounded-[4.786px]" style={{ backgroundImage: "linear-gradient(173.006deg, rgba(255, 255, 255, 0) 17.454%, rgba(0, 0, 0, 0.4) 82.545%)" }} />
                    </div>
                    <div className="bg-[#f7f8fa] bg-clip-text flex flex-col font-['Resident_Evil_Classic_Font:Regular',sans-serif] justify-center leading-[0] not-italic relative shrink-0 text-[43.13px] text-[transparent] text-shadow-[0px_4.313px_0px_rgba(0,0,0,0.4)] tracking-[12.939px] whitespace-nowrap">
                      <p className="leading-[normal]">Classic Collection</p>
                    </div>
                  </div>
                  <div className="absolute inset-[5.52%_0_33.15%_0.05%]">
                    <div className="absolute inset-[0_0_-5.22%_0]">
                      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 624.714 161.327">
                        <g filter="url(#filter0_dd_1_248)" id="Frame 4">
                          <g id="Vector">
                            <path d={svgPaths.p17a70c00} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.p17a70c00} fill="url(#paint0_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                            <path d={svgPaths.pc18a300} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.pc18a300} fill="url(#paint1_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                            <path d={svgPaths.p90f2580} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.p90f2580} fill="url(#paint2_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                            <path d={svgPaths.p1cad1a80} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.p1cad1a80} fill="url(#paint3_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                            <path d={svgPaths.p73ba980} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.p73ba980} fill="url(#paint4_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                            <path d={svgPaths.p14883a80} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.p14883a80} fill="url(#paint5_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                            <path d={svgPaths.pac40380} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.pac40380} fill="url(#paint6_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                            <path d={svgPaths.p11d70e00} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.p11d70e00} fill="url(#paint7_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                            <path d={svgPaths.p1a047980} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.p1a047980} fill="url(#paint8_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                            <path d={svgPaths.p37d51500} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.p37d51500} fill="url(#paint9_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                            <path d={svgPaths.p13772780} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.p13772780} fill="url(#paint10_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                            <path d={svgPaths.p2b742780} fill="var(--fill-0, #FE0000)" />
                            <path d={svgPaths.p2b742780} fill="url(#paint11_linear_1_248)" fillOpacity="0.4" style={{ mixBlendMode: "overlay" }} />
                          </g>
                        </g>
                        <defs>
                          <filter colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse" height="161.327" id="filter0_dd_1_248" width="624.714" x="0" y="0">
                            <feFlood floodOpacity="0" result="BackgroundImageFix" />
                            <feColorMatrix in="SourceAlpha" result="hardAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
                            <feOffset dy="8.00915" />
                            <feComposite in2="hardAlpha" operator="out" />
                            <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.4 0" />
                            <feBlend in2="BackgroundImageFix" mode="normal" result="effect1_dropShadow_1_248" />
                            <feColorMatrix in="SourceAlpha" result="hardAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
                            <feOffset dy="3.43249" />
                            <feComposite in2="hardAlpha" operator="out" />
                            <feColorMatrix type="matrix" values="0 0 0 0 0.519445 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" />
                            <feBlend in2="effect1_dropShadow_1_248" mode="normal" result="effect2_dropShadow_1_248" />
                            <feBlend in="SourceGraphic" in2="effect2_dropShadow_1_248" mode="normal" result="shape" />
                          </filter>
                          {[...Array(12)].map((_, i) => (
                            <linearGradient key={i} gradientUnits="userSpaceOnUse" id={`paint${i}_linear_1_248`} x1="312.357" x2="312.357" y1="153.318" y2="1.00702e-06">
                              <stop stopColor="white" stopOpacity="0" />
                              <stop offset="1" />
                            </linearGradient>
                          ))}
                        </defs>
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Game Cards */}
                <div className="content-stretch flex gap-[48px] h-[616px] items-center justify-center relative shrink-0 w-full">
                  {games.map((game, i) => (
                    <div
                      key={game.id}
                      className="bg-[#0f0f0f] h-[580px] relative rounded-[8px] shrink-0 w-[380px] cursor-pointer transition-transform duration-200"
                      style={{ transform: selected === i ? "scale(1.02)" : "scale(1)" }}
                      onClick={() => { setSelected(i); navigate(`/${game.id}`); }}
                      onMouseEnter={() => setSelected(i)}
                    >
                      <div className="overflow-clip relative rounded-[inherit] size-full">
                        <div className="-translate-y-1/2 absolute h-[580px] left-0 right-0 top-1/2">
                          <img
                            alt={game.label}
                            className={`absolute inset-0 max-w-none object-cover pointer-events-none size-full ${game.rounded ? "rounded-[15.795px]" : ""}`}
                            src={game.img}
                          />
                        </div>
                        {selected === i ? (
                          <div className="absolute bg-[#0f0f0f] inset-0 mix-blend-exclusion pointer-events-none">
                            <div aria-hidden="true" className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px]" />
                            <div className="absolute inset-[-0.5px] rounded-[inherit] shadow-[inset_0px_0px_36px_0px_rgba(255,255,255,0.25)]" />
                          </div>
                        ) : (
                          <div className="absolute bg-[#0f0f0f] inset-0 opacity-60">
                            <div aria-hidden="true" className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px] pointer-events-none" />
                          </div>
                        )}
                      </div>
                      {selected === i && (
                        <>
                          <div className="absolute inset-[-0.5px] pointer-events-none rounded-[inherit] shadow-[inset_0px_4px_36px_0px_rgba(255,255,255,0)]" />
                          <div aria-hidden="true" className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px] pointer-events-none rounded-[8.5px]" />
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <p className="font-['Actor:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[#999] text-[18px] uppercase whitespace-nowrap">
                  © CAPCOM CO.,LTD. 1996, 2025 All Rights Reserved. FAn Concept Julio CACKO
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Helper bar */}
      <div className="absolute bottom-[-1px] content-stretch flex flex-col items-center justify-center left-0 overflow-clip px-[32px] py-[18px] w-[1920px]">
        <div className="content-stretch flex gap-[24px] items-start relative shrink-0">
          <div className="flex gap-[8px] items-center">
            <KeyCap>◄</KeyCap>
            <KeyCap>►</KeyCap>
            <span className="font-['Actor:Regular',sans-serif] text-[#999] text-[24px]">Navigate</span>
          </div>
          <div className="flex gap-[8px] items-center">
            <KeyCap wide>Enter</KeyCap>
            <span className="font-['Actor:Regular',sans-serif] text-[#999] text-[24px]">Confirm</span>
          </div>
          <div className="flex gap-[8px] items-center">
            <KeyCap>Esc</KeyCap>
            <span className="font-['Actor:Regular',sans-serif] text-[#999] text-[24px]">Back</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyCap({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`overflow-clip relative shrink-0 size-[32px] ${wide ? "w-[48px]" : ""}`}>
      <div className="absolute bg-[#2a2a2a] border-[#232323] border-[0.5px] border-solid left-[4px] rounded-[6px] shadow-[1px_1px_1px_0px_rgba(0,0,0,0.1)] size-[24px] top-[4px]" style={wide ? { width: 40 } : {}} />
      <div className="absolute inset-0 flex items-center justify-center text-[#fffffe] text-[10px] font-semibold">
        {children}
      </div>
    </div>
  );
}