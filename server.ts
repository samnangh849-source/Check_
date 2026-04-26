import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { Parser } from 'm3u8-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // 1. Endpoint to scrape the actual .m3u8 link from the iframe page
  app.get('/api/extract-m3u8', async (req, res) => {
    const iframeUrl = req.query.url as string;
    const referer = req.query.referer as string;

    if (!iframeUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
      console.log(`Extracting from iframe: ${iframeUrl}`);
      
      const targetOrigin = new URL(iframeUrl).origin;
      const fetchReferer = referer || targetOrigin;
      // Fetch the iframe HTML content
      const response = await fetch(iframeUrl, {
        headers: {
          'Referer': fetchReferer,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: `Failed to fetch iframe: ${response.statusText}` });
      }

      const html = await response.text();
      
      // Advanced Scraping: Look for the .m3u8 link inside the JS code
      // JW Player usually initializes with a setup block containing the 'file' property
      
      let m3u8Url = null;

      // Try to find the playlist variable first
      const playlistMatch = html.match(/(?:var|const|let)\s+playlist\s*=\s*(\[.*?\]);/s);
      if (playlistMatch) {
        try {
          const playlist = JSON.parse(playlistMatch[1]);
          if (playlist && playlist.length > 0 && playlist[0].sources) {
            const hlsSource = playlist[0].sources.find((s: any) => s.type === 'hls' || s.file.includes('.m3u8'));
            if (hlsSource) {
              m3u8Url = hlsSource.file;
            } else if (playlist[0].sources.length > 0) {
              m3u8Url = playlist[0].sources[0].file;
            }
            
            if (m3u8Url && m3u8Url.startsWith('/')) {
              try {
                m3u8Url = new URL(m3u8Url, iframeUrl).href;
              } catch (e) {}
            }
          }
        } catch (e) {
          console.error("Failed to parse playlist JSON:", e);
        }
      }

      // Fallback: Regex to find typical JW Player setup or source arrays
      if (!m3u8Url) {
        const m3u8Regex = /(["'])(https?:\/\/[^"']+\.m3u8[^"']*)\1/i;
        const match = html.match(m3u8Regex);
        if (match && match[2]) {
          m3u8Url = match[2];
        }
      }

      if (m3u8Url) {
        console.log(`Found m3u8 URL: ${m3u8Url}`);
        return res.json({ m3u8Url });
      }

      // Fallback: Try to find it in a <source> tag if it's a standard HTML5 player
      const $ = cheerio.load(html);
      
      $('source').each((i, el) => {
        const src = $(el).attr('src');
        if (src && src.includes('.m3u8')) {
          m3u8Url = src;
        }
      });

      if (m3u8Url) {
        console.log(`Found m3u8 URL in <source>: ${m3u8Url}`);
        return res.json({ m3u8Url });
      }

      // If we can't find it, return an error
      console.log('Could not find .m3u8 link in the HTML content.');
      // For debugging, you might want to log parts of the HTML
      // console.log(html.substring(0, 1000)); 
      
      return res.status(404).json({ error: 'Could not extract .m3u8 link from the page.' });

    } catch (error: any) {
      console.error('Extraction error:', error);
      res.status(500).json({ error: `Internal Server Error: ${error.message}` });
    }
  });

  // 2. Endpoint to proxy the .m3u8 playlist file
  app.get('/api/proxy-m3u8', async (req, res) => {
    const m3u8Url = req.query.url as string;

    if (!m3u8Url) {
      return res.status(400).send('Missing url parameter');
    }

    try {
      const targetOrigin = new URL(m3u8Url).origin;
      const response = await fetch(m3u8Url, {
        headers: {
          'Referer': targetOrigin,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        return res.status(response.status).send(`Failed to fetch m3u8: ${response.statusText}`);
      }

      const m3u8Content = await response.text();
      
      // Parse the m3u8 file
      const parser = new Parser();
      parser.push(m3u8Content);
      parser.end();
      
      const parsedManifest = parser.manifest;
      const baseUrl = new URL(m3u8Url);
      
      // Rewrite the URLs in the m3u8 file to point to our proxy
      let rewrittenContent = m3u8Content;
      
      // Determine if this is a master playlist (contains other playlists) 
      // or a media playlist (contains video segments)
      const isMasterPlaylist = m3u8Content.includes('#EXT-X-STREAM-INF');
      
      // Simple regex replacement for URLs in the m3u8 file
      // This handles both absolute and relative URLs
      const lines = m3u8Content.split('\n');
      const rewrittenLines = lines.map(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) {
          // It's a comment or tag, leave it mostly alone
          // Exception: URI in tags like #EXT-X-KEY or #EXT-X-MEDIA
          if (line.includes('URI="')) {
             return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                const absoluteUri = new URL(uri, baseUrl.href).href;
                // If it's a media playlist (like audio tracks), proxy as m3u8, else as ts
                const isPlaylist = absoluteUri.includes('.m3u8') || isMasterPlaylist;
                const endpoint = isPlaylist ? '/api/proxy-m3u8' : '/api/proxy-ts';
                return `URI="${endpoint}?url=${encodeURIComponent(absoluteUri)}"`;
             });
          }
          return line;
        }
        
        // It's a URL line (either a .ts segment or a nested .m3u8 playlist)
        try {
          const absoluteUrl = new URL(line, baseUrl.href).href;
          
          // If it's a master playlist, the URLs are nested playlists.
          // If it explicitly has .m3u8, it's a playlist.
          // Otherwise, assume it's a segment.
          if (isMasterPlaylist || absoluteUrl.includes('.m3u8')) {
             return `/api/proxy-m3u8?url=${encodeURIComponent(absoluteUrl)}`;
          } else {
             // It's a segment (.ts, .mp4, etc.), proxy it to the ts endpoint
             return `/api/proxy-ts?url=${encodeURIComponent(absoluteUrl)}`;
          }
        } catch (e) {
          return line; // Fallback if URL parsing fails
        }
      });

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      // Add CORS headers so the browser player can read it
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(rewrittenLines.join('\n'));

    } catch (error: any) {
      console.error('M3U8 Proxy error:', error);
      res.status(500).send(`Internal Server Error: ${error.message}`);
    }
  });

  // 3. Endpoint to proxy the actual video segments (.ts files)
  app.get('/api/proxy-ts', async (req, res) => {
    const tsUrl = req.query.url as string;

    if (!tsUrl) {
      return res.status(400).send('Missing url parameter');
    }

    try {
      const targetOrigin = new URL(tsUrl).origin;
      const response = await fetch(tsUrl, {
        headers: {
          'Referer': targetOrigin,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        return res.status(response.status).send(`Failed to fetch segment: ${response.statusText}`);
      }

      // Forward necessary headers
      // Force video/MP2T content type since some hosts disguise .ts as .png
      res.setHeader('Content-Type', 'video/MP2T');
      
      const contentLength = response.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Stream the segment data
      if (response.body) {
        // @ts-ignore
        const reader = response.body.getReader();
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                res.end();
                break;
              }
              res.write(value);
            }
          } catch (err) {
            console.error('Error streaming segment:', err);
            res.end();
          }
        };
        pump();
      } else {
        res.status(500).send('No response body from segment server');
      }

    } catch (error: any) {
      console.error('TS Proxy error:', error);
      res.status(500).send(`Internal Server Error: ${error.message}`);
    }
  });

  // 4. Endpoint to proxy JSON requests (like dooplayer API)
  app.all('/api/fetch-json', async (req, res) => {
    const targetUrl = req.query.url as string;

    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
      const fetchOptions: RequestInit = {
        method: req.method,
        headers: {
          'Referer': new URL(targetUrl).origin,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      };

      // Forward body for POST/PUT requests
      let finalTargetUrl = targetUrl;
      let urlObj;
      try {
        urlObj = new URL(targetUrl);
      } catch (e) {
        console.error("Invalid target URL:", targetUrl, e);
        return res.status(400).json({ error: 'Invalid URL parameter' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        // For admin-ajax.php, we usually need to send form data
        if (urlObj.searchParams.has('action')) {
          const formData = new URLSearchParams();
          urlObj.searchParams.forEach((value, key) => {
            formData.append(key, value);
          });
          fetchOptions.body = formData;
          fetchOptions.headers = {
            ...fetchOptions.headers,
            'Content-Type': 'application/x-www-form-urlencoded',
          };
          
          // Remove query params from the URL since we're sending them in the body
          urlObj.search = '';
          finalTargetUrl = urlObj.toString();
          fetchOptions.method = 'POST';
        }
      }

      const response = await fetch(finalTargetUrl, fetchOptions);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Proxy request failed: ${response.status} ${response.statusText}`, errorText);
        return res.status(response.status).json({ error: `Failed to fetch: ${response.statusText}`, details: errorText });
      }

      const text = await response.text();
      const contentType = response.headers.get('content-type');
      console.log(`Proxy response content-type: ${contentType}, length: ${text.length}`);

      if (!text) {
        console.error("Empty response from target");
        return res.status(500).json({ error: 'Empty response from target' });
      }

      try {
        const data = JSON.parse(text);
        res.json(data);
      } catch (e) {
        console.error("Failed to parse JSON response from target", text, e);
        return res.status(500).json({ error: 'Failed to parse JSON response from target', details: text, contentType });
      }
    } catch (error: any) {
      console.error('JSON Proxy error:', error);
      res.status(500).json({ error: `Internal Server Error: ${error.message}` });
    }
  });

  // Original proxy endpoint (kept for fallback/reference)
  app.get('/api/proxy-video', async (req, res) => {
    // ... (keep existing implementation)
    const targetUrl = req.query.url as string;

    if (!targetUrl) {
      return res.status(400).send('Missing url parameter');
    }

    try {
      const targetOrigin = new URL(targetUrl).origin;
      const response = await fetch(targetUrl, {
        headers: {
          'Referer': targetOrigin,
        },
      });

      if (!response.ok) {
        return res.status(response.status).send(`Failed to fetch video: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
      
      const contentLength = response.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      
      const acceptRanges = response.headers.get('accept-ranges');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
      
      const contentRange = response.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);

      if (response.body) {
        // @ts-ignore
        const reader = response.body.getReader();
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                res.end();
                break;
              }
              res.write(value);
            }
          } catch (err) {
            console.error('Error streaming video:', err);
            res.end();
          }
        };
        pump();
      } else {
        res.status(500).send('No response body from video server');
      }

    } catch (error) {
      console.error('Proxy error:', error);
      res.status(500).send('Internal Server Error during proxying');
    }
  });

  // 5. Endpoint to download video as MP4 (converts m3u8 to mp4 on the fly or proxies direct mp4)
  app.get('/api/download-mp4', async (req, res) => {
    const videoUrl = req.query.url as string;

    if (!videoUrl) {
      return res.status(400).send('Missing url parameter');
    }

    try {
      res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
      res.setHeader('Content-Type', 'video/mp4');

      // If it's an m3u8, we use ffmpeg to convert it to a fragmented mp4 stream
      if (videoUrl.includes('.m3u8')) {
        const ffmpeg = (await import('fluent-ffmpeg')).default;

        ffmpeg(videoUrl)
          .inputOptions([
            '-headers',
            `Referer: ${new URL(videoUrl).origin}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n`
          ])
          .outputOptions([
            '-c copy', // Copy streams without re-encoding
            '-bsf:a aac_adtstoasc', // Required for HLS audio to MP4
            '-movflags frag_keyframe+empty_moov' // Required for streaming MP4 output over a pipe
          ])
          .format('mp4')
          .on('error', (err) => {
            console.error('FFmpeg error:', err);
            if (!res.headersSent) {
              res.status(500).send('Error converting video');
            } else {
              res.end();
            }
          })
          .pipe(res, { end: true });
      } else {
        // If it's already a direct video URL, just stream it directly
        const targetOrigin = new URL(videoUrl).origin;
        const response = await fetch(videoUrl, {
          headers: {
            'Referer': targetOrigin,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });

        if (!response.ok) {
          return res.status(response.status).send(`Failed to fetch video: ${response.statusText}`);
        }

        if (response.body) {
          const { Readable } = await import('stream');
          // @ts-ignore
          Readable.fromWeb(response.body).pipe(res);
        } else {
          res.status(500).send('No response body from video server');
        }
      }
    } catch (error: any) {
      console.error('Download MP4 error:', error);
      if (!res.headersSent) {
        res.status(500).send(`Internal Server Error: ${error.message}`);
      }
    }
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
