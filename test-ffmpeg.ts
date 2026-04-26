import ffmpeg from 'fluent-ffmpeg';

ffmpeg('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')
  .outputOptions([
    '-c copy',
    '-bsf:a aac_adtstoasc',
    '-movflags frag_keyframe+empty_moov'
  ])
  .format('mp4')
  .on('error', (err) => console.error('Error:', err))
  .on('end', () => console.log('Done'))
  .save('output.mp4');
