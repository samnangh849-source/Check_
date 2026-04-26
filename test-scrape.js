const targetUrl = 'https://khfullhd.co/archives/23505';

async function test() {
  try {
    const res1 = await fetch(targetUrl);
    const html1 = await res1.text();
    
    const iframeMatch = html1.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (!iframeMatch) {
      console.log("No iframe found");
      return;
    }
    const iframeUrl = iframeMatch[1];
    
    const res2 = await fetch(iframeUrl, {
      headers: { 'Referer': 'https://khfullhd.co/' }
    });
    const html2 = await res2.text();
    
    let m3u8Url = null;
    const playlistMatch = html2.match(/var playlist = (\[.*?\]);/s);
    if (playlistMatch) {
      const playlist = JSON.parse(playlistMatch[1]);
      const hlsSource = playlist[0].sources.find((s) => s.type === 'hls' || s.file.includes('.m3u8'));
      if (hlsSource) m3u8Url = hlsSource.file;
    }
    
    if (m3u8Url) {
      const res3 = await fetch(m3u8Url, {
        headers: { 'Referer': 'https://khfullhd.co/' }
      });
      const m3u8Content = await res3.text();
      
      const lines = m3u8Content.split('\n');
      const urlLine = lines.find(l => !l.startsWith('#') && l.trim().length > 0);
      if (urlLine) {
        const absoluteUrl = new URL(urlLine, m3u8Url).href;
        const res4 = await fetch(absoluteUrl, {
          headers: { 'Referer': 'https://khfullhd.co/' }
        });
        const nestedContent = await res4.text();
        
        const nestedLines = nestedContent.split('\n');
        const segmentLine = nestedLines.find(l => !l.startsWith('#') && l.trim().length > 0);
        if (segmentLine) {
          const segmentUrl = new URL(segmentLine, absoluteUrl).href;
          console.log("Segment URL:", segmentUrl);
          
          const res5 = await fetch(segmentUrl, {
            headers: { 'Referer': 'https://khfullhd.co/' }
          });
          const buffer = await res5.arrayBuffer();
          const bytes = new Uint8Array(buffer.slice(0, 16));
          console.log("Magic bytes:", Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
          
          // Check if it's PNG
          if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
            console.log("It's a PNG file!");
          } else if (bytes[0] === 0x47) {
            console.log("It's a TS file! (starts with sync byte 0x47)");
          } else {
            console.log("Unknown format");
          }
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
}

test();
