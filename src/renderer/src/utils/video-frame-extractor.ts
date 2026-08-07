/**
 * 从视频中提取 WebUI 同款的早期视频帧，供图片主色分析使用。
 *
 * @param videoFile - 由受控壁纸协议加载得到的视频文件。
 * @param timeOffset - 目标时间点，默认 0.1 秒以避免首帧黑屏。
 * @returns 质量为 0.95 的 JPEG 帧。
 */
export function extractFirstFrameFromVideo(videoFile: File, timeOffset = 0.1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('无法获取 Canvas 上下文'));
      return;
    }
    const url = URL.createObjectURL(videoFile);

    /**
     * 释放临时对象 URL，并移除用于提帧的 DOM 元素。
     */
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
      canvas.remove();
    };
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      video.currentTime = Math.min(timeOffset, video.duration);
    };
    video.onseeked = () => {
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            cleanup();
            if (blob) resolve(blob);
            else reject(new Error('无法生成视频帧图片'));
          },
          'image/jpeg',
          0.95,
        );
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('视频加载失败'));
    };
    video.src = url;
    video.load();
  });
}

/**
 * 提取视频帧并包装为与 WebUI 同样命名的 JPEG 文件。
 *
 * @param videoFile - 原始视频媒体文件。
 * @param timeOffset - 提取帧的目标时间点。
 * @returns 可直接传给图片取色器的 JPEG 文件。
 */
export async function extractFirstFrameAsFile(videoFile: File, timeOffset = 0.1): Promise<File> {
  const frame = await extractFirstFrameFromVideo(videoFile, timeOffset);
  return new File([frame], `${videoFile.name.replace(/\.[^.]+$/, '')}_frame.jpg`, {
    type: 'image/jpeg',
  });
}
