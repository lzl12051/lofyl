// 一首曲目的元数据
export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number; // 秒
  file?: File;
  sourcePath?: string;
  sourceDisplayPath?: string;
  url?: string; // object URL
  // 虚拟分段字段：指向源文件中的时间范围（秒）。
  // 仅当单个音频文件被自动切分为多个碟面时设置。
  startOffset?: number;
  endOffset?: number;
}

// 一张碟面（Side A / B / C / D...）
export interface DiscSide {
  label: string;      // 'A' | 'B' | 'C' | 'D' ...
  discIndex: number;  // 第几张碟，从 0 开始
  sideIndex: number;  // 第几个面，从 0 开始（全局）
  tracks: Track[];
  totalDuration: number; // 秒
}

// 一张专辑（由若干张碟组成）
export interface Album {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string;
  sides: DiscSide[];
  discs: number; // 碟片总数
}

export interface LibraryAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string;
  sides: Track[][];
  createdAt: number;
  updatedAt: number;
}

// 唱臂状态
export type TonearmState = 'parked' | 'holding' | 'cueing' | 'dropping' | 'playing' | 'returning';

// 盘面专辑图显示模式
export type DiscArtworkMode = 'overlay' | 'centered';

// 播放机整体状态
export interface TurntableState {
  album: Album | null;
  currentSideIndex: number;       // 当前播放哪个面（全局面索引）
  isPlatterSpinning: boolean;
  tonearmState: TonearmState;
  currentTime: number;            // 当前面内播放时间（秒）
  isPlaying: boolean;
}

// 唱针在碟面上的坐标（归一化，圆心为 0,0，外边缘为 1.0）
export interface NeedlePosition {
  angle: number;  // 弧度
  radius: number; // 0（圆心）到 1（外边缘）归一化
}
