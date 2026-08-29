import { useMemo } from 'react';

function buildRunnerHtml(tone: 'wait' | 'failure'): string {
  const sub =
    tone === 'failure'
      ? 'A tool failed — dodge while you decide what to try next.'
      : 'Waiting on Agent Sam — dodge while it works.';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>
  :root{--bg:#0d0d10;--text:#e6e6f0;--muted:#9295a6;--line:rgba(255,255,255,.10);--blue:#5a7df7}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:var(--text);overflow:hidden}
  .game{position:relative;height:220px;border-radius:16px;border:1px solid var(--line);background:linear-gradient(180deg,#11131b 0%,#0b0c12 70%,#0a0a0e 100%);overflow:hidden;touch-action:manipulation;user-select:none}
  .track{position:absolute;left:0;right:0;bottom:56px;height:2px;background:rgba(255,255,255,.6)}
  .runner{position:absolute;left:50px;bottom:58px;width:46px;height:46px}
  .runner.jump{animation:jump .55s cubic-bezier(.2,.7,.2,1)}
  .obstacle{position:absolute;bottom:58px;right:-60px;width:34px;height:50px;animation:obstacle 1.9s linear infinite}
  .paused .obstacle,.paused .track:after{animation-play-state:paused}
  .center-note{position:absolute;left:18px;bottom:16px}
  .hint{font-size:18px;font-weight:800}
  .subhint{margin-top:4px;color:var(--muted);font-size:12px}
  .score{position:absolute;top:10px;right:14px;font-family:ui-monospace,monospace;font-size:12px;color:var(--muted)}
  .game-over{display:none;position:absolute;inset:0;background:rgba(7,7,10,.6);place-items:center;text-align:center}
  .game-over.show{display:grid}
  .btn{border:1px solid var(--line);background:var(--blue);color:#fff;border-radius:999px;padding:8px 12px;font-weight:700;margin-top:8px}
  @keyframes obstacle{from{right:-60px}to{right:calc(100% + 60px)}}
  @keyframes jump{0%,100%{transform:translateY(0)}48%{transform:translateY(-90px)}}
</style></head>
<body>
  <div class="game paused" id="game" tabindex="0" aria-label="Tap or press space to jump">
    <div class="track"></div>
    <div class="runner" id="runner"><svg viewBox="0 0 80 80"><path fill="#f5f7ff" d="M20 18h28v10h10v13h-9v11h-8v10h-9V52H22v14h-9V42h7V18Zm10 9v8h9v-8h-9Zm26 28h11v8H56v-8Z"/><path fill="#5a7df7" d="M48 18h7v8h-7zM14 35h9v7h-9z"/></svg></div>
    <div class="obstacle ob1"><svg viewBox="0 0 60 90"><path fill="#e9ecff" d="M26 8h9v70h-9zM12 34h9v18h-9zM39 24h9v26h-9zM21 44h18v8H21z"/></svg></div>
    <div class="score">SCORE <span id="score">00000</span> · HI <span id="high">00000</span></div>
    <div class="center-note" id="ready"><div class="hint">Press space or tap to play</div><div class="subhint">${sub}</div></div>
    <div class="game-over" id="over"><div><b>GAME OVER</b><div class="subhint">Press space or tap to restart</div><button class="btn" id="restart">Restart</button></div></div>
  </div>
<script>
function safeGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function safeSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){ } }
const game=document.getElementById('game'), runner=document.getElementById('runner'), scoreEl=document.getElementById('score'), highEl=document.getElementById('high'), ready=document.getElementById('ready'), over=document.getElementById('over');
let playing=false, dead=false, score=0, raf=0, high=Number(safeGet('iamRunnerHigh')||0);
highEl.textContent=String(high).padStart(5,'0');
function start(){ if(dead){dead=false;over.classList.remove('show')} playing=true; score=0; ready.style.display='none'; game.classList.remove('paused'); document.querySelectorAll('.obstacle').forEach(o=>{o.style.animation='none';o.offsetHeight;o.style.animation=''}); tick(); }
function jump(e){ if(e&&e.target&&e.target.closest&&e.target.closest('#restart'))return; if(!playing||dead){start();return} if(runner.classList.contains('jump'))return; runner.classList.add('jump'); setTimeout(()=>runner.classList.remove('jump'),550); }
function end(){ dead=true; playing=false; game.classList.add('paused'); over.classList.add('show'); cancelAnimationFrame(raf); if(score>high){high=score;safeSet('iamRunnerHigh',String(high));highEl.textContent=String(high).padStart(5,'0')} }
function hit(a,b){ const r1=a.getBoundingClientRect(), r2=b.getBoundingClientRect(); return !(r1.right-10<r2.left+6||r1.left+10>r2.right-6||r1.bottom-6<r2.top+8||r1.top+8>r2.bottom-6); }
function tick(){ if(!playing||dead)return; score+=1; scoreEl.textContent=String(score).padStart(5,'0'); document.querySelectorAll('.obstacle').forEach(o=>{if(hit(runner,o))end()}); raf=requestAnimationFrame(tick); }
document.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();jump()}});
game.addEventListener('pointerdown',jump);
const restartBtn=document.getElementById('restart');
restartBtn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();start()});
restartBtn.addEventListener('pointerdown',e=>{e.stopPropagation()});
</script>
</body></html>`;
}

export type OfflineRunnerEmbedProps = {
  className?: string;
  height?: number;
  /** failure = only shown after a tool error; wait kept for rare callers */
  tone?: 'wait' | 'failure';
};

export function OfflineRunnerEmbed({
  className = '',
  height = 240,
  tone = 'wait',
}: OfflineRunnerEmbedProps) {
  const srcDoc = useMemo(() => buildRunnerHtml(tone), [tone]);
  return (
    <iframe
      title={tone === 'failure' ? 'Agent Sam failure runner' : 'Agent Sam wait-runner'}
      className={className}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-same-origin"
      style={{ width: '100%', height, border: 'none', borderRadius: 16, display: 'block' }}
    />
  );
}
