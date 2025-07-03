// CLI-скрипт для конвертации и сжатия видео в WebM
// Укажите параметры ниже:

// Команда для запуска скрипта: node convert-video.js

// Путь к исходному видеофайлу (mp4, mov и др.)
const inputPath = '/home/dan/Project/gornostyle/public/images/professional_training.mp4';

// Папка для сохранения результата
const outputDir = '../public/images/videos';

// Желаемый размер итогового файла (в мегабайтах, от 1 до 10)
const targetSizeMB = 5;

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

function getVideoOrientation(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);
      const stream = metadata.streams.find(s => s.width && s.height);
      if (!stream) return reject('Не удалось определить размер видео');
      const { width, height } = stream;
      const orientation = width >= height ? 'landscape' : 'portrait';
      resolve({ width, height, orientation });
    });
  });
}

async function convertWithBitrate(inputPath, outputPath, orientation, videoBitrateKbps) {
  return new Promise((resolve, reject) => {
    const scale = orientation === 'landscape' ? '1280:-2' : '-2:1280';
    ffmpeg(inputPath)
      .videoCodec('libvpx-vp9')
      .audioCodec('libopus')
      .outputOptions([
        `-b:v ${videoBitrateKbps}k`,
        '-crf 30',
        '-deadline good',
        '-b:a 128k'
      ])
      .videoFilters(`scale=${scale}`)
      .on('end', () => resolve())
      .on('error', reject)
      .save(outputPath);
  });
}

async function autoConvertToTargetSize(inputPath, outputDir, orientation, targetSizeMB) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filename = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${filename}.webm`);

  let bitrate = 900; // стартовый битрейт (kbps)
  const minBitrate = 400; // минимальный битрейт (kbps)
  const step = 150; // шаг уменьшения битрейта
  let lastSize = 0;
  let attempts = 0;
  let success = false;

  while (bitrate >= minBitrate) {
    attempts++;
    console.log(`\nПопытка ${attempts}: конвертация с битрейтом ${bitrate}k...`);
    await convertWithBitrate(inputPath, outputPath, orientation, bitrate);
    const stats = fs.statSync(outputPath);
    lastSize = stats.size / 1024 / 1024; // MB
    console.log(`Размер файла: ${lastSize.toFixed(2)} MB (цель: ${targetSizeMB} MB)`);
    if (lastSize <= targetSizeMB) {
      success = true;
      break;
    }
    bitrate -= step;
  }

  if (!success) {
    console.warn(`\nНе удалось достичь желаемого размера. Итоговый размер: ${lastSize.toFixed(2)} MB (битрейт: ${bitrate + step}k)`);
  } else {
    console.log(`\nУспешно! Итоговый размер: ${lastSize.toFixed(2)} MB (битрейт: ${bitrate}k)`);
  }
  return outputPath;
}

async function generatePreview(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const filename = path.basename(inputPath, path.extname(inputPath));
    const previewJpg = path.join(outputDir, `${filename}-preview.jpg`);
    const previewWebp = path.join(outputDir, `${filename}-preview.webp`);
    // Сохраняем кадр примерно с 0.8 секунды (20-й кадр при 25 fps)
    ffmpeg(inputPath)
      .on('end', async () => {
        // Конвертируем JPG в WebP
        try {
          await sharp(previewJpg).webp({ quality: 80 }).toFile(previewWebp);
          fs.unlinkSync(previewJpg); // удаляем временный JPG
          console.log(`Превью сохранено: ${previewWebp}`);
          resolve(previewWebp);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', reject)
      .screenshots({
        timestamps: ['00:00:01.0'], // 1.0 секунды
        filename: `${filename}-preview.jpg`,
        folder: outputDir,
        size: '640x?'
      });
  });
}

(async () => {
  try {
    const { width, height, orientation } = await getVideoOrientation(inputPath);
    console.log(`Ориентация видео: ${orientation} (${width}x${height})`);
    let outputVideoPath, previewPath;
    try {
      outputVideoPath = await autoConvertToTargetSize(inputPath, outputDir, orientation, targetSizeMB);
    } catch (err) {
      console.error('Ошибка при конвертации видео:', err);
      process.exit(1);
    }
    try {
      previewPath = await generatePreview(inputPath, outputDir);
    } catch (err) {
      console.error('Ошибка при генерации превью:', err);
      previewPath = null;
    }
    console.log('\n==============================');
    console.log('✅ Обработка завершена!');
    console.log(`Видео: ${outputVideoPath}`);
    if (previewPath) {
      console.log(`Превью: ${previewPath}`);
    } else {
      console.log('Превью не создано.');
    }
    console.log('==============================\n');
  } catch (err) {
    console.error('Фатальная ошибка:', err);
    process.exit(1);
  }
})();

// --- Дальнейшая логика будет реализована ниже ---

// TODO: Определить ориентацию видео (landscape/portrait)
// TODO: Автоматически подобрать битрейт для достижения нужного размера
// TODO: Конвертировать в WebM с нужным разрешением
// TODO: (Опционально) Сгенерировать превью-изображение
// TODO: Выводить прогресс и обработку ошибок 