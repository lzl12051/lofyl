import type { DiscSide, Track } from '../types';
import { resolveTrackAtTime } from './albumSplitter';

/**
 * VinylEngine：负责实际音频播放和黑胶音效。
 *
 * 架构分两层：
 * 1. 主音频层（musicSource）：播放实际音乐文件，通过 playbackRate 做 wow & flutter
 * 2. 音效层（effectsChain）：程序化生成底噪、爆音、空白轨道白噪音
 */
export class VinylEngine {
  private ctx: AudioContext;

  // 主音频
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode;
  private analyser: AnalyserNode;
  private analyserData: Float32Array<ArrayBuffer>;
  private musicBuffer: AudioBuffer | null = null;

  // Wow & flutter LFO
  private wowLFO: OscillatorNode | null = null;
  private wowDepth: GainNode;

  // 底噪（持续低电平白噪音）
  private vinylNoiseSource: AudioBufferSourceNode | null = null;
  private vinylNoiseGain: GainNode;

  // 播放状态
  private isPlaying = false;
  private currentSide: DiscSide | null = null;
  private currentTimeInSide = 0;      // 面内时间（秒）
  private playStartContextTime = 0;   // AudioContext 时间戳（开始播放时）
  private playStartSideTime = 0;      // 面内时间（开始播放时）
  private activeTrackIndex = -1;
  private activeTrackOffset = 0;       // 当前曲目内的偏移（秒）

  // 曲目 buffer 缓存（keyed by track.id，存切片后的 buffer）
  private trackBuffers: Map<string, AudioBuffer> = new Map();

  // 源文件 buffer 缓存（keyed by track.url，存解码后的完整 buffer）
  // 用于虚拟分段：同一个文件只解码一次，按 offset 切片给各分段。
  // loadSide 完成后清空以释放内存。
  private sourceBuffers: Map<string, AudioBuffer> = new Map();

  // 爆音定时器
  private crackleTimer: ReturnType<typeof setTimeout> | null = null;

  // 状态回调
  public onTimeUpdate: ((time: number) => void) | null = null;
  public onSpectrumUpdate: ((levels: number[]) => void) | null = null;
  public onSideEnded: (() => void) | null = null;
  public onTrackChange: ((trackIndex: number) => void) | null = null;

  private rafId: number | null = null;
  private spectrumIntervalId: number | null = null;
  private visualBandLevels: number[] = [];
  private spectrumBandCount: number = 12;

  constructor() {
    this.ctx = new AudioContext();

    // 主音乐增益
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 1.0;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.minDecibels = -96;
    this.analyser.maxDecibels = -18;
    this.analyser.smoothingTimeConstant = 0.68;
    this.analyserData = new Float32Array(
      new ArrayBuffer(this.analyser.frequencyBinCount * Float32Array.BYTES_PER_ELEMENT),
    );
    this.musicGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Wow & flutter 深度节点（连接到 musicSource.playbackRate，初始化后再连）
    this.wowDepth = this.ctx.createGain();
    this.wowDepth.gain.value = 0.003; // 0.3% 音调偏移深度

    // 底噪增益（默认静音，播放时开启）
    this.vinylNoiseGain = this.ctx.createGain();
    this.vinylNoiseGain.gain.value = 0;
    this.vinylNoiseGain.connect(this.ctx.destination);

    this.createVinylNoise();
  }

  // ─── 公共 API ────────────────────────────────────────────────

  /** 加载一张面的所有曲目 buffer */
  async loadSide(side: DiscSide): Promise<void> {
    this.currentSide = side;
    // 并发加载所有曲目
    await Promise.all(side.tracks.map((track) => this.loadTrackBuffer(track)));
    // 切片完成后清空源文件缓存，释放大块内存（切片结果保留在 trackBuffers）
    this.sourceBuffers.clear();
  }

  /** 从面内指定时间开始播放 */
  async play(timeInSide: number): Promise<void> {
    return this.playWithOptions(timeInSide);
  }

  async playWithOptions(
    timeInSide: number,
    options: { keepNoise?: boolean } = {}
  ): Promise<void> {
    if (!this.currentSide) return;

    await this.ctx.resume();

    this.stop({ keepNoise: options.keepNoise });

    const result = resolveTrackAtTime(this.currentSide, timeInSide);
    if (!result) return;

    const { trackIndex, offsetInTrack } = result;
    const track = this.currentSide.tracks[trackIndex];
    const buffer = this.trackBuffers.get(track.id);
    if (!buffer) return;

    // 创建 source
    this.musicSource = this.ctx.createBufferSource();
    this.musicSource.buffer = buffer;
    this.musicSource.connect(this.musicGain);

    // 设置 Wow & flutter
    this.setupWowFlutter();

    // 播放
    this.musicSource.start(0, offsetInTrack);
    this.isPlaying = true;
    this.currentTimeInSide = timeInSide;
    this.playStartContextTime = this.ctx.currentTime;
    this.playStartSideTime = timeInSide;
    this.activeTrackIndex = trackIndex;
    this.activeTrackOffset = offsetInTrack;

    this.onTrackChange?.(trackIndex);

    // 底噪渐入
    this.vinylNoiseGain.gain.setTargetAtTime(0.012, this.ctx.currentTime, 0.5);

    // 当前曲目结束时续播下一首
    this.musicSource.onended = () => {
      if (!this.isPlaying) return;
      this.playNextTrack();
    };

    this.startTimeTracking();
    this.scheduleCrackles();
  }

  async startLeadInNoise(): Promise<void> {
    await this.ctx.resume();
    const now = this.ctx.currentTime;
    this.vinylNoiseGain.gain.cancelScheduledValues(now);
    this.vinylNoiseGain.gain.setValueAtTime(0.0015, now);
    this.vinylNoiseGain.gain.linearRampToValueAtTime(0.010, now + 0.7);
    this.vinylNoiseGain.gain.linearRampToValueAtTime(0.018, now + 1.8);
    this.vinylNoiseGain.gain.linearRampToValueAtTime(0.016, now + 2.3);
  }

  stopLeadInNoise(): void {
    this.vinylNoiseGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.vinylNoiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
  }

  /** 暂停 */
  pause(): void {
    if (!this.isPlaying) return;
    this.currentTimeInSide = this.getCurrentTime();
    this.stop();
  }

  /** 停止并重置 */
  stop(options: { keepNoise?: boolean } = {}): void {
    this.isPlaying = false;
    this.visualBandLevels = this.visualBandLevels.map(() => 0);

    if (this.musicSource) {
      this.musicSource.onended = null;
      try { this.musicSource.stop(); } catch { /* 已停止 */ }
      this.musicSource = null;
    }

    if (this.wowLFO) {
      try { this.wowLFO.stop(); } catch { /* 已停止 */ }
      this.wowLFO = null;
    }

    if (this.crackleTimer) {
      clearTimeout(this.crackleTimer);
      this.crackleTimer = null;
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.stopSpectrumTracking();

    if (!options.keepNoise) {
      // 底噪渐出
      this.vinylNoiseGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    }
  }

  /** 实时面内时间（秒） */
  getCurrentTime(): number {
    if (!this.isPlaying) return this.currentTimeInSide;
    return this.playStartSideTime + (this.ctx.currentTime - this.playStartContextTime);
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getVisualLevels(count: number = 12): number[] {
    if (count <= 0) return [];

    if (!this.isPlaying || !this.musicSource) {
      this.visualBandLevels = new Array(count).fill(0);
      return [...this.visualBandLevels];
    }

    if (this.visualBandLevels.length !== count) {
      this.visualBandLevels = new Array(count).fill(0);
    }

    this.analyser.getFloatFrequencyData(this.analyserData);
    const nyquist = this.ctx.sampleRate / 2;
    const minFreq = 42;
    const maxFreq = Math.min(14_000, nyquist * 0.96);
    const dbSpan = this.analyser.maxDecibels - this.analyser.minDecibels;

    for (let bandIndex = 0; bandIndex < count; bandIndex += 1) {
      const startFreq = minFreq * Math.pow(maxFreq / minFreq, bandIndex / count);
      const endFreq = minFreq * Math.pow(maxFreq / minFreq, (bandIndex + 1) / count);
      const start = Math.max(
        0,
        Math.min(
          this.analyserData.length - 1,
          Math.floor((startFreq / nyquist) * this.analyserData.length),
        ),
      );
      const end = Math.max(
        start + 1,
        Math.min(
          this.analyserData.length,
          Math.ceil((endFreq / nyquist) * this.analyserData.length),
        ),
      );

      let sumDb = 0;
      let totalWeight = 0;
      for (let bin = start; bin < end; bin += 1) {
        const db = this.analyserData[bin];
        if (!Number.isFinite(db)) continue;
        const weight = 1 + ((bin - start) / Math.max(1, end - start)) * 0.16;
        sumDb += db * weight;
        totalWeight += weight;
      }

      const avgDb = totalWeight > 0 ? sumDb / totalWeight : this.analyser.minDecibels;
      const normalized = Math.max(
        0,
        Math.min(1, (avgDb - this.analyser.minDecibels) / dbSpan),
      );
      const tiltCompensation =
        0.76 + (bandIndex / Math.max(1, count - 1)) * 0.5;
      const shaped = Math.max(
        0,
        Math.min(1, Math.pow(normalized, 1.12) * tiltCompensation),
      );
      const current = this.visualBandLevels[bandIndex] ?? 0;
      const smoothing = shaped > current ? 0.38 : 0.16;
      this.visualBandLevels[bandIndex] = current + (shaped - current) * smoothing;
    }

    return [...this.visualBandLevels];
  }

  destroy(): void {
    this.stop();
    this.stopSpectrumTracking();
    if (this.vinylNoiseSource) {
      try { this.vinylNoiseSource.stop(); } catch { /* 已停止 */ }
    }
    this.ctx.close();
  }

  // ─── 内部方法 ─────────────────────────────────────────────────

  private async loadTrackBuffer(track: Track): Promise<void> {
    if (this.trackBuffers.has(track.id)) return;
    if (!track.url) return;

    try {
      // 同一源文件只解码一次
      let sourceBuffer = this.sourceBuffers.get(track.url);
      if (!sourceBuffer) {
        const response = await fetch(track.url);
        const arrayBuffer = await response.arrayBuffer();
        sourceBuffer = await this.ctx.decodeAudioData(arrayBuffer);
        this.sourceBuffers.set(track.url, sourceBuffer);
      }

      // 虚拟分段：切出 [startOffset, endOffset] 区间
      if (track.startOffset !== undefined || track.endOffset !== undefined) {
        const start = track.startOffset ?? 0;
        const end = track.endOffset ?? sourceBuffer.duration;
        this.trackBuffers.set(track.id, sliceAudioBuffer(this.ctx, sourceBuffer, start, end));
      } else {
        this.trackBuffers.set(track.id, sourceBuffer);
      }
    } catch (e) {
      console.error(`Failed to load track: ${track.title}`, e);
    }
  }

  private setupWowFlutter(): void {
    if (!this.musicSource) return;

    // LFO：模拟皮带驱动的音调微弱波动
    this.wowLFO = this.ctx.createOscillator();
    this.wowLFO.frequency.value = 0.8 + Math.random() * 0.4; // 0.8~1.2Hz
    this.wowLFO.type = 'sine';
    this.wowLFO.connect(this.wowDepth);
    this.wowDepth.connect(this.musicSource.playbackRate);
    this.musicSource.playbackRate.value = 1.0;
    this.wowLFO.start();
  }

  private playNextTrack(): void {
    if (!this.currentSide) return;

    const nextTrackIndex = this.activeTrackIndex + 1;
    if (nextTrackIndex >= this.currentSide.tracks.length) {
      // 这面播完了
      this.isPlaying = false;
      this.vinylNoiseGain.gain.setTargetAtTime(0.006, this.ctx.currentTime, 0.5); // 保留微弱底噪
      this.onSideEnded?.();
      return;
    }

    const nextTrack = this.currentSide.tracks[nextTrackIndex];
    const buffer = this.trackBuffers.get(nextTrack.id);
    if (!buffer) return;

    // 计算下一首的面内起始时间
    let accumulated = 0;
    for (let i = 0; i < nextTrackIndex; i++) {
      accumulated += this.currentSide.tracks[i].duration;
    }

    this.musicSource = this.ctx.createBufferSource();
    this.musicSource.buffer = buffer;
    this.musicSource.connect(this.musicGain);
    this.setupWowFlutter();
    this.musicSource.start(0, 0);

    this.activeTrackIndex = nextTrackIndex;
    this.activeTrackOffset = 0;
    this.playStartContextTime = this.ctx.currentTime;
    this.playStartSideTime = accumulated;

    this.onTrackChange?.(nextTrackIndex);

    this.musicSource.onended = () => {
      if (!this.isPlaying) return;
      this.playNextTrack();
    };
  }

  /** 程序化生成低电平黑胶底噪 */
  private createVinylNoise(): void {
    const bufferSize = this.ctx.sampleRate * 4; // 4 秒循环
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // 带通滤波的粉红噪音近似
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // 粉红噪音近似（Voss 算法简化版）
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      data[i] = (b0 + b1 + b2 + white * 0.0556) * 0.11;
    }

    this.vinylNoiseSource = this.ctx.createBufferSource();
    this.vinylNoiseSource.buffer = buffer;
    this.vinylNoiseSource.loop = true;

    // 带通滤波，模拟黑胶频率特性（主要是高频滚降）
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 0.3;

    this.vinylNoiseSource.connect(filter);
    filter.connect(this.vinylNoiseGain);
    this.vinylNoiseSource.start();
  }

  /** 随机安排灰尘爆音 */
  private scheduleCrackles(): void {
    if (!this.isPlaying) return;

    // 随机间隔 1~8 秒触发一次爆音
    const delay = (1 + Math.random() * 7) * 1000;
    this.crackleTimer = setTimeout(() => {
      if (this.isPlaying) {
        this.triggerCrackle();
        this.scheduleCrackles();
      }
    }, delay);
  }

  /** 触发一次程序化爆音 */
  private triggerCrackle(): void {
    const duration = 0.002 + Math.random() * 0.008; // 2~10ms
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // 短暂白噪音脉冲，带包络
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.pow(1 - i / bufferSize, 2); // 快速衰减
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    // 爆音音量有随机性
    gain.gain.value = 0.08 + Math.random() * 0.18;

    // 高频滤波，给爆音"噼啪"质感
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3000 + Math.random() * 4000;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
  }

  /** 使用 rAF 持续更新时间并触发回调（节流至 ~15 FPS） */
  private startTimeTracking(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    let lastUpdateTime = 0;
    const TIME_INTERVAL = 66; // ~15 FPS

    const tick = (now: number) => {
      if (!this.isPlaying) return;
      if (now - lastUpdateTime >= TIME_INTERVAL) {
        this.onTimeUpdate?.(this.getCurrentTime());
        lastUpdateTime = now;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);

    this.startSpectrumTracking();
  }

  /** 独立的频谱更新定时器（~20 FPS） */
  private startSpectrumTracking(): void {
    this.stopSpectrumTracking();
    this.spectrumIntervalId = window.setInterval(() => {
      if (!this.isPlaying) return;
      const levels = this.getVisualLevels(this.spectrumBandCount);
      this.onSpectrumUpdate?.(levels);
    }, 16); // ~60 FPS
  }

  private stopSpectrumTracking(): void {
    if (this.spectrumIntervalId !== null) {
      clearInterval(this.spectrumIntervalId);
      this.spectrumIntervalId = null;
    }
  }

  /** 设置频谱分析的频段数 */
  setSpectrumBandCount(count: number): void {
    this.spectrumBandCount = count;
  }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 从 source AudioBuffer 中切出 [startSec, endSec] 区间，返回新 AudioBuffer。
 * 用于虚拟分段：同一个源文件按碟面时间范围切片，避免重复解码。
 */
function sliceAudioBuffer(
  ctx: AudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sr = source.sampleRate;
  const startSample = Math.floor(startSec * sr);
  const endSample = Math.min(Math.ceil(endSec * sr), source.length);
  const frameCount = Math.max(0, endSample - startSample);

  const sliced = ctx.createBuffer(source.numberOfChannels, frameCount, sr);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    sliced.getChannelData(ch).set(source.getChannelData(ch).subarray(startSample, endSample));
  }
  return sliced;
}
