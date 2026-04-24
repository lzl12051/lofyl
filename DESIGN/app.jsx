// =========================================================
// Lofyl · 黑胶播放器 Demo
// =========================================================
const { useState, useEffect, useRef, useMemo } = React;

// ---------- 数据 ----------
// 用占位 SVG 作封面，避免外网依赖；每张封面独立色调
function makeCover({bgA,bgB,sun,sea,title,subtitle,theme}){
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400' width='400' height='400'>
    <defs>
      <linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'>
        <stop offset='0%' stop-color='${bgA}'/>
        <stop offset='55%' stop-color='${bgB}'/>
        <stop offset='100%' stop-color='${sea}'/>
      </linearGradient>
      <radialGradient id='glow' cx='50%' cy='62%' r='30%'>
        <stop offset='0%' stop-color='${sun}' stop-opacity='.95'/>
        <stop offset='60%' stop-color='${sun}' stop-opacity='.15'/>
        <stop offset='100%' stop-color='${sun}' stop-opacity='0'/>
      </radialGradient>
    </defs>
    <rect width='400' height='400' fill='url(#sky)'/>
    <rect width='400' height='400' fill='url(#glow)'/>
    <circle cx='200' cy='250' r='38' fill='${sun}' opacity='.95'/>
    <!-- 海面反光 -->
    <g opacity='.55'>
      <rect x='60' y='288' width='280' height='1.5' fill='${sun}'/>
      <rect x='80' y='296' width='240' height='1.2' fill='${sun}' opacity='.75'/>
      <rect x='100' y='304' width='200' height='1' fill='${sun}' opacity='.55'/>
      <rect x='120' y='312' width='160' height='.8' fill='${sun}' opacity='.4'/>
      <rect x='140' y='320' width='120' height='.6' fill='${sun}' opacity='.3'/>
    </g>
    <!-- 海浪纹理 -->
    <g opacity='.35' fill='none' stroke='${sun}' stroke-width='.6'>
      <path d='M0 340 Q 100 335 200 342 T 400 340'/>
      <path d='M0 358 Q 100 352 200 360 T 400 358'/>
      <path d='M0 376 Q 100 370 200 378 T 400 376'/>
    </g>
    <!-- 云层 -->
    <g fill='${sun}' opacity='.18'>
      <ellipse cx='80' cy='90' rx='70' ry='6'/>
      <ellipse cx='320' cy='120' rx='55' ry='5'/>
    </g>
  </svg>`;
  return 'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)));
}

// 统一日落色系封面，但每张微调
const COVERS = {
  goldenHour: makeCover({bgA:'#1a2a4a',bgB:'#d88644',sun:'#ffd27a',sea:'#2a1410'}),
  oceanEyes:  makeCover({bgA:'#0e1a38',bgB:'#6a88b4',sun:'#f0e8d0',sea:'#1a1a2e'}),
  sundayMorn: makeCover({bgA:'#2a2012',bgB:'#d4a86a',sun:'#f2dba0',sea:'#3a2418'}),
  paperPlanes:makeCover({bgA:'#3a1a2a',bgB:'#e0846a',sun:'#ffc080',sea:'#2a1018'}),
  quietShores:makeCover({bgA:'#102030',bgB:'#4a7ab4',sun:'#e8d080',sea:'#081828'}),
  nightDrive: makeCover({bgA:'#100820',bgB:'#6a3a7a',sun:'#f080a0',sea:'#0a0416'}),
};

// 专辑库
const ALBUMS = [
  {
    id:'golden-hour',
    title:'Golden Hour',
    artist:'Luminous Coast',
    year:2023,
    label:'Neiro Pop Records',
    genre:'Indie Pop / Dream Pop',
    spec:'17 音轨 · 57 分 18 秒',
    category:'pop',
    cover:COVERS.goldenHour,
    desc:'《Golden Hour》是 Luminous Coast 的第三张录音室专辑，以温暖而梦幻的声响勾勒海天交界处，混合合成器的涟漪与希望氛围。在吉他和合成器交叉的旋律里，音乐伯德带人们归航，海边的黄金时刻。',
    tracks:[
      {side:'A', no:1,  name:'Golden Hour',      t:'02:14'},
      {side:'A', no:2,  name:'Ocean Eyes',       t:'02:48'},
      {side:'A', no:3,  name:'Paper Planes',     t:'03:45'},
      {side:'A', no:4,  name:'Westwind',         t:'03:11'},
      {side:'A', no:5,  name:'Midnight Echoes',  t:'03:32'},
      {side:'B', no:6,  name:'Echoes in Rain',   t:'04:41'},
      {side:'B', no:7,  name:'Sunday Drive',     t:'04:05'},
      {side:'B', no:8,  name:'Quiet Shores',     t:'04:32'},
      {side:'B', no:9,  name:'Until We Fade',    t:'04:31'},
      {side:'B', no:10, name:'Starlight',        t:'04:35'},
    ],
    total:'56:56',
  },
  {
    id:'ocean-eyes', title:'Ocean Eyes', artist:'Marlo Vent',
    year:2021, label:'Coral Records', genre:'Chillwave',
    spec:'12 音轨 · 41 分 20 秒', category:'electronic', cover:COVERS.oceanEyes,
    desc:'潮汐般的合成器与人声在脑海里反复回荡，Marlo Vent 的第二张专辑是对深蓝与午夜的致敬。',
    tracks:[
      {side:'A',no:1,name:'Deep Blue',t:'03:20'},
      {side:'A',no:2,name:'Lantern',t:'03:45'},
      {side:'A',no:3,name:'Tide',t:'04:02'},
      {side:'A',no:4,name:'Harbor Lights',t:'03:18'},
      {side:'B',no:5,name:'Foreshore',t:'03:55'},
      {side:'B',no:6,name:'Underwater',t:'04:10'},
      {side:'B',no:7,name:'Drift',t:'03:44'},
    ],
    total:'41:20',
  },
  {
    id:'sunday-morning', title:'Sunday Morning', artist:'Acoustic Sessions',
    year:2022, label:'Daybreak', genre:'Folk / Acoustic',
    spec:'9 音轨 · 36 分 40 秒', category:'folk', cover:COVERS.sundayMorn,
    desc:'一个阳光缓慢的周日早晨，木吉他、钢琴与人声的即兴碰撞，Acoustic Sessions 系列的第四辑。',
    tracks:[
      {side:'A',no:1,name:'Morning Light',t:'03:41'},
      {side:'A',no:2,name:'Coffee & Rain',t:'04:02'},
      {side:'A',no:3,name:'Paper Kites',t:'03:55'},
      {side:'A',no:4,name:'Window Seat',t:'03:28'},
      {side:'B',no:5,name:'Afternoon Pages',t:'04:18'},
      {side:'B',no:6,name:'Slow Hours',t:'04:05'},
    ],
    total:'36:40',
  },
  {
    id:'paper-planes', title:'Paper Planes', artist:'Youth Parade',
    year:2020, label:'Skylight', genre:'Indie Rock',
    spec:'11 音轨 · 44 分 10 秒', category:'rock', cover:COVERS.paperPlanes,
    desc:'躁动与克制之间，一张记录少年心事的摇滚专辑。',
    tracks:[
      {side:'A',no:1,name:'Paper Planes',t:'03:22'},
      {side:'A',no:2,name:'Neon Curfew',t:'03:45'},
      {side:'A',no:3,name:'Runaway',t:'04:01'},
      {side:'B',no:4,name:'City Bright',t:'03:52'},
      {side:'B',no:5,name:'Echo Valley',t:'04:22'},
    ],
    total:'44:10',
  },
  {
    id:'quiet-shores', title:'Quiet Shores', artist:'Halcyon',
    year:2024, label:'Blue Hour', genre:'Ambient Jazz',
    spec:'8 音轨 · 48 分 20 秒', category:'jazz', cover:COVERS.quietShores,
    desc:'萨克斯与合成器织就的夜空，Halcyon 的氛围爵士漫游。',
    tracks:[
      {side:'A',no:1,name:'Shoreline',t:'05:42'},
      {side:'A',no:2,name:'Blue Hour',t:'06:10'},
      {side:'B',no:3,name:'Driftwood',t:'07:02'},
      {side:'B',no:4,name:'Lighthouse',t:'05:55'},
    ],
    total:'48:20',
  },
  {
    id:'night-drive', title:'Night Drive', artist:'Nova Club',
    year:2023, label:'Chromatic', genre:'Synthwave',
    spec:'10 音轨 · 42 分 50 秒', category:'electronic', cover:COVERS.nightDrive,
    desc:'午夜高速上的霓虹与合成器节拍。',
    tracks:[
      {side:'A',no:1,name:'Ignition',t:'03:30'},
      {side:'A',no:2,name:'Overpass',t:'04:12'},
      {side:'B',no:3,name:'Chrome',t:'04:44'},
      {side:'B',no:4,name:'Vanish',t:'04:20'},
    ],
    total:'42:50',
  },
];

const CATEGORIES = [
  {key:'all',   label:'全部', count:124},
  {key:'pop',   label:'流行', count:42},
  {key:'rock',  label:'摇滚', count:28},
  {key:'jazz',  label:'爵士', count:19},
  {key:'electronic', label:'电子', count:22},
  {key:'folk',  label:'民谣', count:13},
];

// ---------- 自适应舞台 ----------
function Stage({children}){
  const ref = useRef(null);
  useEffect(()=>{
    const fit = ()=>{
      if(!ref.current) return;
      const pad = 24;
      const sx = (window.innerWidth  - pad*2) / 1280;
      const sy = (window.innerHeight - pad*2) / 920;
      const s = Math.min(sx, sy, 1);
      ref.current.style.transform = `scale(${s})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return ()=>window.removeEventListener('resize', fit);
  },[]);
  return (
    <div style={{width:'100%',height:'100%',display:'grid',placeItems:'center'}}>
      <div ref={ref} className="stage">{children}</div>
    </div>
  );
}

// ---------- 频谱条 ----------
function Spectrum({playing, volume, activeness}){
  const N = 32;
  const [bars, setBars] = useState(()=>new Array(N).fill(6));
  const basePattern = useRef(null);
  if(!basePattern.current){
    // 预设一个频响曲线（低频高、中频次之、高频衰减）
    basePattern.current = new Array(N).fill(0).map((_,i)=>{
      const x = i/(N-1);
      // 三个高斯峰
      const g = (c,s,h)=> Math.exp(-((x-c)**2)/(2*s*s))*h;
      return g(0.1,.15,1.0)+g(0.35,.15,.85)+g(0.6,.18,.7)+g(0.85,.12,.55);
    });
  }
  useEffect(()=>{
    let raf, t=0;
    const tick = ()=>{
      t += 0.08 * activeness;
      const next = basePattern.current.map((base,i)=>{
        if(!playing) return 22 + Math.sin(t*0.6+i*0.35)*8 + Math.sin(t*0.3+i*0.9)*5;
        const noise = Math.sin(t*1.3 + i*0.7)*0.35 + Math.sin(t*2.1+i*1.2)*0.25 + Math.random()*0.4;
        const v = Math.max(0.08, base*(0.85 + noise*0.5));
        const vol = 0.4 + volume*0.7;
        return Math.min(1, v*vol*activeness) * 62 + 4;
      });
      setBars(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[playing, volume, activeness]);

  return (
    <>
      <div className="bars">
        {bars.map((h,i)=>(
          <div key={i} className="bar" style={{height:h+'px'}}/>
        ))}
      </div>
      <div className="freq-labels">
        <span>40</span><span>100</span><span>250</span><span>660</span>
        <span>1.6K</span><span>4K</span><span>10K</span><span>16K</span>
      </div>
    </>
  );
}

// ---------- 旋钮（可拖动 / 滚轮） ----------
function BigKnob({value, onChange, min=0, max=1, label, ticks, size=68}){
  // value: 0~1
  const angle = -135 + value*270;
  const ref = useRef(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(0);

  const onDown = (e)=>{
    dragging.current=true;
    startY.current = e.clientY;
    startVal.current = value;
    e.currentTarget.classList.add('active');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const onMove = (e)=>{
    if(!dragging.current) return;
    const dy = startY.current - e.clientY;
    const next = Math.max(0, Math.min(1, startVal.current + dy/160));
    onChange(next);
  };
  const onUp = ()=>{
    dragging.current=false;
    if(ref.current) ref.current.classList.remove('active');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  const onWheel = (e)=>{
    e.preventDefault();
    const next = Math.max(0, Math.min(1, value + (e.deltaY>0?-0.05:0.05)));
    onChange(next);
  };

  return (
    <div className="col">
      <div className="label-sm">{label}</div>
      <div ref={ref} className="knob-lg" style={{width:size,height:size}}
           onPointerDown={onDown} onWheel={onWheel}>
        <div className="tick" style={{transform:`translateX(-50%) rotate(${angle}deg)`,transformOrigin:'50% 34px'}}/>
      </div>
      {ticks && (
        <div className="tick-marks" style={{width:size+20}}>
          {ticks.map((t,i)=><span key={i}>{t}</span>)}
        </div>
      )}
    </div>
  );
}

// ---------- 小圆钮（电源 / 速度） ----------
function SmallKnob({label, sub, onClick, active}){
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
      <div className={"knob small"} onClick={onClick} style={{
        boxShadow: active
          ? '0 6px 10px rgba(0,0,0,.55), inset 0 2px 2px rgba(255,240,215,.5), inset 0 -3px 4px rgba(0,0,0,.4), 0 0 12px rgba(240,180,75,.7)'
          : undefined
      }}/>
      <div className="knob-label">{label}</div>
      {sub && <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:9,color:'rgba(90,58,31,.7)',letterSpacing:'.1em'}}>{sub}</div>}
    </div>
  );
}

// ---------- 唱片架一张专辑（正面 / 侧面） ----------
function AlbumItem({album, isCurrent, onClick}){
  if(isCurrent){
    return (
      <div className="album front" onClick={onClick}>
        <div className="cover-img" style={{backgroundImage:`url(${album.cover})`}}/>
        <div className="cover-overlay"/>
        <div className="cover-title">
          {album.title.split(' ').map((w,i)=>(<div key={i}>{w.toUpperCase()}</div>))}
        </div>
        <div className="stereo-badge">
          <div>{album.year}</div>
          <div style={{fontSize:7,opacity:.85,letterSpacing:'.12em'}}>STEREO<br/>LP</div>
        </div>
      </div>
    );
  }
  return (
    <div className="album side" onClick={onClick} title={album.title}>
      <div className="spine-art" style={{backgroundImage:`url(${album.cover})`}}/>
      <div className="spine-txt">{album.title}</div>
    </div>
  );
}

// ---------- 主 App ----------
function App(){
  const [albumIdx, setAlbumIdx] = useState(()=>{
    const v = +(localStorage.getItem('lofyl.album')||0);
    return isNaN(v)?0:v;
  });
  const [trackIdx, setTrackIdx] = useState(()=>{
    const v = +(localStorage.getItem('lofyl.track')||0);
    return isNaN(v)?0:v;
  });
  const [playing, setPlaying] = useState(false);
  const [power, setPower] = useState(true);
  const [speed45, setSpeed45] = useState(false); // false=33⅓, true=45
  const [volume, setVolume] = useState(0.55);
  const [speedKnob, setSpeedKnob] = useState(0.35);
  const [category, setCategory] = useState('all');

  // tweaks
  const [spinDur, setSpinDur] = useState(4);
  const [specAct, setSpecAct] = useState(1.0);
  const [woodTone, setWoodTone] = useState('warm');
  const [accent, setAccent] = useState('amber');

  const album = ALBUMS[albumIdx];
  const track = album.tracks[Math.min(trackIdx, album.tracks.length-1)];

  // 持久化
  useEffect(()=>{ localStorage.setItem('lofyl.album', albumIdx); },[albumIdx]);
  useEffect(()=>{ localStorage.setItem('lofyl.track', trackIdx); },[trackIdx]);

  // 断电 → 强制停播
  useEffect(()=>{ if(!power) setPlaying(false); },[power]);

  // 按分类过滤架上唱片
  const visibleAlbums = useMemo(()=>{
    if(category==='all') return ALBUMS;
    const list = ALBUMS.filter(a=>a.category===category);
    return list.length ? list : ALBUMS;
  },[category]);

  const switchAlbum = (a)=>{
    const newIdx = ALBUMS.findIndex(x=>x.id===a.id);
    if(newIdx===albumIdx) return;
    setAlbumIdx(newIdx);
    setTrackIdx(0);
    // 切碟时短暂暂停、再自动续播
    if(playing){
      setPlaying(false);
      setTimeout(()=>setPlaying(true), 900);
    }
  };

  const nextTrack = ()=>{
    if(trackIdx < album.tracks.length-1) setTrackIdx(trackIdx+1);
    else {
      // 切下一张
      const n = (albumIdx+1) % ALBUMS.length;
      setAlbumIdx(n); setTrackIdx(0);
    }
  };
  const prevTrack = ()=>{
    if(trackIdx > 0) setTrackIdx(trackIdx-1);
  };

  // 键盘快捷键
  useEffect(()=>{
    const onKey = (e)=>{
      if(e.target.tagName==='INPUT') return;
      if(e.code==='Space'){ e.preventDefault(); if(power) setPlaying(p=>!p); }
      else if(e.code==='ArrowRight') nextTrack();
      else if(e.code==='ArrowLeft') prevTrack();
    };
    window.addEventListener('keydown', onKey);
    return ()=>window.removeEventListener('keydown', onKey);
  });

  // Tweaks: 外部面板同步
  useEffect(()=>{
    const panel = document.getElementById('tweaks-panel');
    const sp = document.getElementById('tw-speed');
    const sa = document.getElementById('tw-spec');
    sp.value = spinDur;
    sa.value = specAct;
    sp.oninput = (e)=>setSpinDur(+e.target.value);
    sa.oninput = (e)=>setSpecAct(+e.target.value);
    panel.querySelectorAll('[data-wood]').forEach(el=>{
      el.classList.toggle('active', el.dataset.wood===woodTone);
      el.onclick = ()=>setWoodTone(el.dataset.wood);
    });
    panel.querySelectorAll('[data-accent]').forEach(el=>{
      el.classList.toggle('active', el.dataset.accent===accent);
      el.onclick = ()=>setAccent(el.dataset.accent);
    });
  });

  // Tweaks 协议
  useEffect(()=>{
    const onMsg = (e)=>{
      if(!e.data) return;
      if(e.data.type==='__activate_edit_mode'){
        document.getElementById('tweaks-panel').classList.add('show');
      }else if(e.data.type==='__deactivate_edit_mode'){
        document.getElementById('tweaks-panel').classList.remove('show');
      }
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({type:'__edit_mode_available'},'*');
    return ()=>window.removeEventListener('message', onMsg);
  },[]);

  // 木纹色切换
  const woodBg = {
    warm:  'linear-gradient(180deg,#d9ab74 0%,#c38d58 55%,#a5743f 100%)',
    amber: 'linear-gradient(180deg,#e8b97a 0%,#c99464 55%,#8f5a28 100%)',
    dark:  'linear-gradient(180deg,#9a6c3e 0%,#7c5028 55%,#5a3a1f 100%)',
  }[woodTone];

  const accentColor = {amber:'#f0b44b', green:'#6fd48f', blue:'#6ab6f0'}[accent];

  return (
    <Stage>
      <div className="cabinet" style={{background: `radial-gradient(ellipse at 50% 120%, rgba(0,0,0,.55), transparent 60%), ${woodBg}`}}>
        <div className="inlay"/>
        <div className="top-handle">Lofyl · Turntable</div>
      </div>

      <div className="grid">

        {/* ========== 唱盘 ========== */}
        <div className="slot turntable">
          <div className="tt-inner"/>
          {/* 左侧两个旋钮 */}
          <div className="knob-col">
            <SmallKnob label="POWER" active={power} onClick={()=>setPower(p=>!p)}/>
            <SmallKnob label={speed45?'45':'33⅓'} sub={speed45?'45':'33⅓ · 45'} onClick={()=>setSpeed45(s=>!s)}/>
          </div>

          {/* 黑胶 + 唱臂 */}
          <div className="deck">
            <div className="vinyl-wrap">
              <div className={"vinyl "+(playing && power ? 'playing':'')}
                   style={{animationDuration: (spinDur/(speed45?1.35:1)) + 's'}}>
                <div className="label">
                  <img src={album.cover} alt=""/>
                </div>
                <div className="label-spindle"/>
              </div>
            </div>
          </div>

          <svg className={"tonearm-svg "+(playing && power ? '' : 'parked')} viewBox="0 0 260 260">
            <defs>
              <linearGradient id="armGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#555"/>
                <stop offset="40%" stopColor="#e8e8e8"/>
                <stop offset="60%" stopColor="#a0a0a0"/>
                <stop offset="100%" stopColor="#3a3a3a"/>
              </linearGradient>
              <radialGradient id="baseGrad" cx="35%" cy="30%">
                <stop offset="0%" stopColor="#f5e4c4"/>
                <stop offset="55%" stopColor="#b0874f"/>
                <stop offset="100%" stopColor="#5b3c14"/>
              </radialGradient>
              <radialGradient id="baseInner" cx="40%" cy="40%">
                <stop offset="0%" stopColor="#3a2a14"/>
                <stop offset="100%" stopColor="#0d0702"/>
              </radialGradient>
            </defs>
            {/* 底座大圆盘 */}
            <circle cx="215" cy="48" r="30" fill="url(#baseGrad)"
                    style={{filter:'drop-shadow(0 3px 6px rgba(0,0,0,.55))'}}/>
            <circle cx="215" cy="48" r="18" fill="url(#baseInner)"/>
            <circle cx="215" cy="48" r="4" fill="#2a1808"/>
            {/* 主臂杆：从底座斜向左下延伸 */}
            <line x1="215" y1="48" x2="96" y2="188"
                  stroke="url(#armGrad)" strokeWidth="5" strokeLinecap="round"/>
            {/* 臂杆阴影 */}
            <line x1="216" y1="50" x2="97" y2="190"
                  stroke="rgba(0,0,0,.35)" strokeWidth="2" strokeLinecap="round"/>
            {/* 中段配重环 */}
            <circle cx="205" cy="60" r="7" fill="#c0c0c0" stroke="#555" strokeWidth=".6"/>
            {/* 唱头（头壳） */}
            <g transform="translate(96 188) rotate(40)">
              <rect x="-18" y="-5" width="32" height="18" rx="3" ry="3"
                    fill="#1a1a1a" stroke="#000" strokeWidth=".6"
                    style={{filter:'drop-shadow(0 2px 3px rgba(0,0,0,.6))'}}/>
              <rect x="-16" y="-3" width="28" height="4" fill="rgba(255,255,255,.1)"/>
              {/* 唱针 */}
              <line x1="-6" y1="13" x2="-6" y2="20" stroke="#888" strokeWidth="1.5"/>
              <circle cx="-6" cy="20.5" r="1.2" fill="#ccc"/>
            </g>
          </svg>

          <div className="brand-stamp">Lofyl</div>
        </div>

        {/* ========== 控制台 ========== */}
        <div className="console">
          <span className="screw tl"/><span className="screw tr"/>
          <span className="screw bl"/><span className="screw br"/>

          <BigKnob value={speedKnob} onChange={setSpeedKnob} label="SPEED" size={68}
                   ticks={[speed45?'45':'33⅓','','45']} />

          <div className="spectrum" style={{'--amber': accentColor}}>
            <div className="now-playing">{power?'NOW PLAYING':'— OFF —'}</div>
            <div className="np-title" style={{color:accentColor, textShadow:`0 0 6px ${accentColor}80`}}>
              {power ? (track.name + ' · ' + album.artist) : '…'}
            </div>
            <Spectrum playing={playing && power} volume={volume} activeness={specAct}/>
          </div>

          <div className="col">
            <BigKnob value={volume} onChange={setVolume} label="VOLUME" size={68}
                     ticks={['MIN','','MAX']} />
          </div>
        </div>

        {/* ========== 唱片架 ========== */}
        <div className="shelf">
          <div className="tabs">
            {CATEGORIES.map(c=>(
              <div key={c.key}
                   className={"tab "+(category===c.key?'active':'')}
                   onClick={()=>setCategory(c.key)}>
                {c.label}
                <span className="cnt">{c.count}</span>
              </div>
            ))}
            <div className="tab add" title="新建分类">+</div>
          </div>
          <div className="shelf-box">
            <div className="albums-row">
              {/* 前面一排侧视（占位装饰，用 ALBUMS 循环） */}
              {visibleAlbums.slice(0,3).map((a,i)=>(
                a.id !== album.id && <AlbumItem key={'l'+a.id} album={a} onClick={()=>switchAlbum(a)}/>
              ))}
              {/* 再插入一些装饰 spine */}
              {new Array(5).fill(0).map((_,i)=>{
                const a = ALBUMS[(i+2)%ALBUMS.length];
                return a.id!==album.id && <AlbumItem key={'d1'+i} album={a} onClick={()=>switchAlbum(a)}/>
              })}

              {/* 正面展示 */}
              <AlbumItem album={album} isCurrent onClick={()=>setPlaying(p=>!p)}/>

              {new Array(5).fill(0).map((_,i)=>{
                const a = ALBUMS[(i+3)%ALBUMS.length];
                return a.id!==album.id && <AlbumItem key={'d2'+i} album={a} onClick={()=>switchAlbum(a)}/>
              })}

              {visibleAlbums.slice(-2).map((a,i)=>(
                a.id !== album.id && <AlbumItem key={'r'+a.id} album={a} onClick={()=>switchAlbum(a)}/>
              ))}
            </div>
          </div>
        </div>

        {/* ========== 信息 ========== */}
        <div className="info">
          <div className="paper album-card">
            <div className="album-card-top">
              <div className="mini-cover" style={{backgroundImage:`url(${album.cover})`}}/>
              <div className="meta">
                <div className="title">{album.title}</div>
                <div className="artist">{album.artist}</div>
                <dl className="kv">
                  <dt>发行年份</dt><dd>{album.year}</dd>
                  <dt>发行公司</dt><dd>{album.label}</dd>
                  <dt>音乐风格</dt><dd>{album.genre}</dd>
                  <dt>唱片规格</dt><dd>{album.spec}</dd>
                </dl>
              </div>
            </div>
            <div className="desc">{album.desc}</div>
          </div>

          <div className="paper tracklist">
            <div className="tl-head">
              <span>曲目列表</span>
              <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,color:'#8a6a3c',fontWeight:400,letterSpacing:'.1em',whiteSpace:'nowrap'}}>
                {playing?'▶ 播放中':'■ 已暂停'}
              </span>
            </div>

            {['A','B'].map(side=>{
              const rows = album.tracks.filter(t=>t.side===side);
              if(!rows.length) return null;
              return (
                <React.Fragment key={side}>
                  <div className="side-label">{side} 面</div>
                  {rows.map((t)=>{
                    const curIdx = album.tracks.findIndex(x=>x.no===t.no);
                    const active = curIdx === trackIdx;
                    return (
                      <div key={t.no} className={"track "+(active?'active':'')}
                           onClick={()=>{ setTrackIdx(curIdx); if(power) setPlaying(true); }}
                           style={active ? {color:accentColor} : undefined}>
                        <span className="idx" style={active?{color:accentColor}:undefined}>{t.no}.</span>
                        <span className="name" style={active?{color:accentColor}:undefined}>{t.name}</span>
                        <span className="time">{t.t}</span>
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}

            <div className="track-foot">总时长: {album.total}</div>
          </div>
        </div>

      </div>
    </Stage>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
