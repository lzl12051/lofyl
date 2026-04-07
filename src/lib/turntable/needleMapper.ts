/**
 * 黑胶唱片的几何参数（归一化坐标，碟片外半径 = 1.0）
 *
 * 真实 12 寸 LP：
 *   外边缘（第一首歌起始）：约 146mm 半径 → 归一化 ~0.97
 *   内边缘（最后一首结束）：约 60mm 半径  → 归一化 ~0.40
 *   标签区域内边缘：约 50mm 半径
 *
 * 这个文件只做几何换算，不依赖任何音频或 UI。
 */

export const GROOVE_OUTER_RADIUS = 0.97; // 第一道刻槽（面开始）
export const GROOVE_INNER_RADIUS = 0.42; // 最后一道刻槽（面结束）
export const LABEL_RADIUS = 0.35;        // 中心标签区域
export const MAX_PLAYABLE_SIDE_DURATION = 23 * 60; // 单面最长 23 分钟

export function getPlayableInnerRadius(totalSideDuration: number): number {
  const fill = Math.min(1, Math.max(0, totalSideDuration / MAX_PLAYABLE_SIDE_DURATION));
  return GROOVE_OUTER_RADIUS - fill * (GROOVE_OUTER_RADIUS - GROOVE_INNER_RADIUS);
}

/**
 * 将碟面上的点（像素坐标，圆心为原点）转换为该面内的播放时间。
 *
 * @param x - 相对于碟心的 x 像素坐标
 * @param y - 相对于碟心的 y 像素坐标
 * @param discRadius - 碟片在画布上的像素半径
 * @param totalSideDuration - 该面总时长（秒）
 * @returns 该面内的播放时间（秒），若点击在标签区或碟片外则返回 null
 */
export function pointToSideTime(
  x: number,
  y: number,
  discRadius: number,
  totalSideDuration: number
): number | null {
  const dist = Math.sqrt(x * x + y * y);
  const normalizedRadius = dist / discRadius;
  const playableInnerRadius = getPlayableInnerRadius(totalSideDuration);

  // 点击在标签区或碟片外，忽略
  if (normalizedRadius < playableInnerRadius || normalizedRadius > 1.0) {
    return null;
  }

  // 将半径线性映射到时间
  // 外圈（GROOVE_OUTER_RADIUS）= 时间 0
  // 内圈（GROOVE_INNER_RADIUS）= 时间 totalSideDuration
  const clampedRadius = Math.min(
    GROOVE_OUTER_RADIUS,
    Math.max(playableInnerRadius, normalizedRadius)
  );
  const playableSpan = GROOVE_OUTER_RADIUS - playableInnerRadius;

  const t =
    (GROOVE_OUTER_RADIUS - clampedRadius) /
    playableSpan;

  return t * totalSideDuration;
}

/**
 * 将面内播放时间换算为唱针的归一化半径位置（用于渲染唱臂）。
 *
 * @param timeInSide - 当前面内播放时间（秒）
 * @param totalSideDuration - 该面总时长（秒）
 * @returns 归一化半径（0~1，相对于碟片外半径）
 */
export function sideTimeToRadius(
  timeInSide: number,
  totalSideDuration: number
): number {
  const t = Math.min(1, Math.max(0, timeInSide / totalSideDuration));
  const playableInnerRadius = getPlayableInnerRadius(totalSideDuration);
  return GROOVE_OUTER_RADIUS - t * (GROOVE_OUTER_RADIUS - playableInnerRadius);
}

/**
 * 给定曲目在面内的起始偏移时间，返回对应的标签刻槽半径。
 * 用于在碟面上渲染每首曲目的起始位置提示（极淡的标记）。
 */
export function trackOffsetToRadius(
  trackOffsetTime: number,
  totalSideDuration: number
): number {
  return sideTimeToRadius(trackOffsetTime, totalSideDuration);
}

/**
 * 计算唱臂旋转角度（弧度）。
 * 唱臂枢轴在碟片右侧固定位置，唱针从碟片外圈扫到内圈。
 *
 * @param needleRadius - 唱针当前归一化半径
 * @param pivotDistance - 唱臂枢轴到碟心的归一化距离
 * @param armLength - 唱臂长度（归一化）
 * @returns 唱臂旋转角度（弧度），相对于"停靠位"
 */
export function needleRadiusToArmAngle(
  needleRadius: number,
  pivotDistance: number = 1.3,
  armLength: number = pivotDistance
): number {
  // 根据三角形三边关系反推唱臂与水平轴的夹角。
  const cosAngle =
    (pivotDistance * pivotDistance + armLength * armLength - needleRadius * needleRadius)
    / (2 * pivotDistance * armLength);
  const clamped = Math.min(1, Math.max(-1, cosAngle));
  return Math.PI / 2 - Math.acos(clamped);
}
