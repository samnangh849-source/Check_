import React, { useState, useRef, useEffect } from 'react';
import { Play, Loader2, AlertCircle, CheckCircle2, Server, Film, Copy, Check, Code, Download } from 'lucide-react';

export default function App() {
  const [inputUrl, setInputUrl] = useState<string>('https://khfullhd.co/archives/23505');
  const [inputType, setInputType] = useState<'url' | 'source'>('url');
  const [inputSource, setInputSource] = useState<string>('');
  const [copied, setCopied] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [m3u8Url, setM3u8Url] = useState<string | null>(null);
  const [manualIframeUrl, setManualIframeUrl] = useState<string>('');
  const [playlists, setPlaylists] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [showSource, setShowSource] = useState<boolean>(false);
  const iframeContainerRef = useRef<HTMLDivElement>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleFetchVideo = async () => {
    setStatus('loading');
    setVideoUrl(null);
    setM3u8Url(null);
    setPlaylists([]);
    setErrorMessage(null);
    setRawHtml(null);
    setShowSource(false);

    try {
      let htmlContent = null;

      if (inputType === 'url') {
        const targetUrl = inputUrl;
        let fetchSuccess = false;

        const proxies = [
          `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
          `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
        ];

        for (const proxyUrl of proxies) {
          try {
            const response = await fetch(proxyUrl);
            if (!response.ok) continue;

            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
              const data = await response.json();
              htmlContent = data.contents;
            } else {
              htmlContent = await response.text();
            }

            if (htmlContent) {
              setRawHtml(htmlContent);
              fetchSuccess = true;
              break;
            }
          } catch (err) {
            console.warn(`Proxy fail:`, err);
          }
        }

        if (!fetchSuccess || !htmlContent) {
          throw new Error("មិនអាចទាញយកបានទេ។ អាចមកពី Network របស់អ្នកមានបញ្ហា។");
        }
      } else {
        htmlContent = inputSource;
        if (!htmlContent.trim()) {
          throw new Error("សូមបញ្ចូលកូដដើម (Page Source) ជាមុនសិន។");
        }
        setRawHtml(htmlContent);
      }

      // Check for playlists array in the HTML
      const playlistsMatch = htmlContent.match(/const playlists = (\[.*?\]);/s);
      if (playlistsMatch) {
        try {
          // The JSON might not be perfectly strict (e.g., trailing commas, missing quotes on keys)
          // We can use a regex to extract the file URLs
          const fileMatches = [...playlistsMatch[1].matchAll(/file:\s*["']([^"']+)["']/g)];
          if (fileMatches.length > 0) {
            const extractedUrls = fileMatches.map(m => {
              let url = m[1];
              if (url.startsWith('//')) {
                url = 'https:' + url;
              }
              return url;
            });
            setPlaylists(extractedUrls);
            setStatus('success');
            return; // We found the playlists, no need to look for iframes
          }
        } catch (e) {
          console.warn("Failed to parse playlists array", e);
        }
      }

      // Check for dooplay_player_option elements
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, "text/html");
      const playerOptions = doc.querySelectorAll('.dooplay_player_option');
      
      if (playerOptions.length > 0) {
        const extractedUrls: string[] = [];
        
        // Try to find the API URL from dtAjax variable in the source code
        let playerApi = '';
        let ajaxUrlBase = '';
        const dtAjaxMatch = htmlContent.match(/var dtAjax = (\{.*?\});/);
        if (dtAjaxMatch) {
          try {
            const dtAjax = JSON.parse(dtAjaxMatch[1]);
            playerApi = dtAjax.player_api || '';
            ajaxUrlBase = dtAjax.url || '';
          } catch (e) {
            console.warn("Failed to parse dtAjax", e);
          }
        }

        // If we found the API, let's fetch the first episode's real video URL
        if (playerApi || ajaxUrlBase) {
          // Find the first option that is not a trailer
          let firstOption = playerOptions[0];
          for (let i = 0; i < playerOptions.length; i++) {
            const nume = playerOptions[i].getAttribute('data-nume');
            if (nume !== 'trailer') {
              firstOption = playerOptions[i];
              break;
            }
          }
          
          const postId = firstOption.getAttribute('data-post');
          const nume = firstOption.getAttribute('data-nume');
          const type = firstOption.getAttribute('data-type');
          
          if (postId && nume && type) {
            let fetchUrl = playerApi ? `${playerApi}${postId}/${type}/${nume}` : '';
            
            // Try wp-json first, then fallback to admin-ajax.php
            const tryFetch = async (url: string, isAjax: boolean = false) => {
              try {
                // Try our backend proxy first
                let proxyUrl = `/api/fetch-json?url=${encodeURIComponent(url)}`;
                let fetchOptions: RequestInit = {};
                
                if (isAjax) {
                  fetchOptions.method = 'POST';
                }
                
                let res = await fetch(proxyUrl, fetchOptions);
                
                // If backend proxy fails, try allorigins (only for GET)
                if (!res.ok && !isAjax) {
                  console.log("Backend proxy failed, trying allorigins...");
                  const allOriginsUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
                  const aoRes = await fetch(allOriginsUrl);
                  if (aoRes.ok) {
                    const aoData = await aoRes.json();
                    if (aoData.contents) {
                      try {
                        // allorigins returns the content as a string in data.contents
                        const parsedContent = JSON.parse(aoData.contents);
                        // Create a mock response object that returns this parsed content
                        res = {
                          ok: true,
                          json: async () => parsedContent
                        } as any;
                      } catch (e) {
                        console.warn("Failed to parse allorigins response", aoData.contents, e);
                      }
                    } else {
                      console.warn("allorigins response missing contents", aoData);
                    }
                  } else {
                    console.warn("allorigins request failed", aoRes.status, aoRes.statusText);
                  }
                }

                if (res.ok) {
                  const text = await res.text();
                  try {
                    const embedData = JSON.parse(text);
                    
                    if (embedData && embedData.embed_url) {
                      let embedUrl = embedData.embed_url;
                      
                      if (embedUrl.includes('<iframe')) {
                        const iframeMatch = embedUrl.match(/src=["']([^"']+)["']/);
                        if (iframeMatch) {
                          embedUrl = iframeMatch[1];
                        }
                      }
                      
                      setVideoUrl(embedUrl);
                      
                      try {
                        let referer = '';
                        try {
                          referer = new URL(playerApi).origin;
                        } catch (e) {}
                        
                        const extractRes = await fetch(`/api/extract-m3u8?url=${encodeURIComponent(embedUrl)}&referer=${encodeURIComponent(referer)}`);
                        if (extractRes.ok) {
                          const extractData = await extractRes.json();
                          if (extractData.m3u8Url) {
                            setM3u8Url(extractData.m3u8Url);
                          }
                        }
                      } catch (e) {
                        console.warn("Failed to extract m3u8 from embed URL", e);
                      }
                      
                      setStatus('success');
                      return true;
                    }
                  } catch (e) {
                    console.warn("Failed to parse JSON response", text, e);
                  }
                } else {
                  console.warn("Proxy request failed", res.status, res.statusText);
                }
              } catch (e) {
                console.warn(`Failed to fetch from ${url}`, e);
              }
              return false;
            };

            // Try wp-json API
            let success = false;
            if (fetchUrl) {
              success = await tryFetch(fetchUrl);
            }
            
            // If wp-json fails, try admin-ajax.php fallback
            if (!success && ajaxUrlBase) {
              let ajaxUrl = '';
              try {
                // Construct absolute URL if it's relative
                if (ajaxUrlBase.startsWith('/')) {
                  const origin = new URL(inputUrl).origin;
                  ajaxUrl = `${origin}${ajaxUrlBase}?action=doo_player_ajax&post=${postId}&nume=${nume}&type=${type}`;
                } else {
                  ajaxUrl = `${ajaxUrlBase}?action=doo_player_ajax&post=${postId}&nume=${nume}&type=${type}`;
                }
              } catch (e) {}
              
              if (ajaxUrl) {
                console.log("Falling back to admin-ajax.php:", ajaxUrl);
                success = await tryFetch(ajaxUrl, true);
              }
            }
            
            if (success) return;
          }
        }
        
        // If we found player options but failed to fetch any of them
        if (playerOptions.length > 0) {
          throw new Error("វេបសាយនេះប្រើប្រាស់ប្រព័ន្ធ Dooplay ដែលលាក់ Link វីដេអូពិតប្រាកដ។ សូមប្រើប្រាស់មុខងារ Inspect -> Network នៅក្នុង Browser របស់អ្នក រួចស្វែងរកពាក្យ \"m3u8\" ឬ \"mp4\" នៅពេលវីដេអូកំពុងលេង។ ប្រសិនបើរាវរកមិនឃើញ សូមសាកល្បងស្វែងរកពាក្យ \"iframe\" ឬ \"embed\" ឬ \"admin-ajax\" ជំនួសវិញ។");
        }
      }

      const iframes = doc.querySelectorAll('.movieplay iframe, iframe, .embed-container iframe');

      if (iframes.length > 0) {
        // Find the first iframe that looks like a video player
        let src = '';
        
        for (let i = 0; i < iframes.length; i++) {
          const iframe = iframes[i] as HTMLIFrameElement;
          const iframeSrc = iframe.src || iframe.getAttribute('data-src') || iframe.getAttribute('data-lazy-src') || '';
          if (iframeSrc && !iframeSrc.includes('googletagmanager') && !iframeSrc.includes('facebook') && !iframeSrc.includes('twitter')) {
            src = iframeSrc;
            break;
          }
        }
        
        if (src) {
          setVideoUrl(src);
          
          // Now, let's try to extract the m3u8 using our backend
          try {
            let referer = '';
            try {
              referer = new URL(inputUrl).origin;
            } catch (e) {}
            
            const extractRes = await fetch(`/api/extract-m3u8?url=${encodeURIComponent(src)}&referer=${encodeURIComponent(referer)}`);
            if (extractRes.ok) {
              const data = await extractRes.json();
              if (data.m3u8Url) {
                setM3u8Url(data.m3u8Url);
              }
            }
          } catch (e) {
            console.warn("Failed to extract m3u8 directly, falling back to iframe proxy", e);
          }

          setStatus('success');
          return;
        }
      } 
      
      // Check for <video> or <source> tags directly
      const videoTags = doc.querySelectorAll('video, source');
      for (let i = 0; i < videoTags.length; i++) {
        const vTag = videoTags[i] as HTMLVideoElement | HTMLSourceElement;
        const vSrc = vTag.src || vTag.getAttribute('data-src') || '';
        if (vSrc && (vSrc.includes('.mp4') || vSrc.includes('.m3u8') || vSrc.includes('blob:'))) {
           if (vSrc.includes('.m3u8')) {
             setM3u8Url(vSrc);
           }
           setVideoUrl(vSrc);
           setStatus('success');
           return;
        }
      }
      
      // Check for specific player configurations (like Vue.js components or data attributes)
      const playerDiv = doc.querySelector('#player');
      if (playerDiv) {
        // Sometimes the video URL is passed to a Vue component or similar
        // We can try to extract it from the surrounding context or specific attributes
        // For this specific site, the actual video URL might be fetched via an API call
        // triggered by the Vue component. We'll try to find any m3u8 in the page source first.
      }
      
      // Special handling for 123av.com and similar sites using Vue
      const pageVideoDiv = doc.querySelector('#page-video');
      if (pageVideoDiv) {
        const vScopeAttr = pageVideoDiv.getAttribute('v-scope');
        if (vScopeAttr && vScopeAttr.includes('Movie(')) {
          const match = vScopeAttr.match(/id:\s*(\d+)/);
          if (match && match[1]) {
            const movieId = match[1];
            // We found the movie ID, now we need to fetch the actual video URL
            // This usually involves an API call to something like /api/v1/movies/{id}/play
            // Since we don't know the exact API endpoint from the HTML alone,
            // we will instruct the user to use the Network tab.
            throw new Error(`រកឃើញលេខកូដវីដេអូ (ID: ${movieId}) ប៉ុន្តែវេបសាយនេះប្រើប្រាស់ប្រព័ន្ធការពារ (API) ដើម្បីលាក់ Link វីដេអូពិតប្រាកដ។ សូមប្រើប្រាស់មុខងារ Inspect -> Network នៅក្នុង Browser របស់អ្នក រួចស្វែងរកពាក្យ "m3u8" ឬ "mp4" នៅពេលវីដេអូកំពុងលេង។`);
          }
        }
      }
      
      // If no iframe found, check if there's a direct m3u8 link in the HTML
      // We explicitly ignore the videoAd m3u8 because it's just an advertisement
      
      // 1. Try to find the playlist variable first (JW Player)
      const playlistMatch = htmlContent.match(/(?:var|const|let)\s+playlist\s*=\s*(\[.*?\]);/s);
      if (playlistMatch) {
        try {
          const playlist = JSON.parse(playlistMatch[1]);
          if (playlist && playlist.length > 0 && playlist[0].sources) {
            const hlsSource = playlist[0].sources.find((s: any) => s.type === 'hls' || s.file.includes('.m3u8'));
            let fileUrl = '';
            if (hlsSource) {
              fileUrl = hlsSource.file;
            } else if (playlist[0].sources.length > 0) {
              fileUrl = playlist[0].sources[0].file;
            }
            
            if (fileUrl) {
              // Resolve relative URL
              if (fileUrl.startsWith('/')) {
                try {
                  fileUrl = new URL(fileUrl, inputUrl).href;
                } catch (e) {}
              }
              
              if (fileUrl.includes('.m3u8') || hlsSource) {
                setM3u8Url(fileUrl);
              }
              setVideoUrl(fileUrl);
              setStatus('success');
              return;
            }
          }
        } catch (e) {
          console.warn("Failed to parse playlist JSON:", e);
        }
      }

      // 2. Try regex for m3u8
      const m3u8Matches = [...htmlContent.matchAll(/(https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*)/gi)];
      if (m3u8Matches.length > 0) {
        // Find the first m3u8 that is NOT an ad
        let realM3u8 = null;
        for (const match of m3u8Matches) {
          const url = match[1].replace(/\\/g, ''); // Remove any escaped slashes
          if (!url.includes('ads.khflix.top') && !url.includes('videoAd')) {
            realM3u8 = url;
            break;
          }
        }
        
        if (realM3u8) {
          setM3u8Url(realM3u8);
          setVideoUrl(realM3u8); // Set videoUrl as fallback
          setStatus('success');
          return;
        }
      }

      // 3. Try regex for mp4
      const mp4Matches = [...htmlContent.matchAll(/(https?:\/\/[^\s"'<>]+?\.mp4[^\s"'<>]*)/gi)];
      if (mp4Matches.length > 0) {
        let realMp4 = null;
        for (const match of mp4Matches) {
          const url = match[1].replace(/\\/g, ''); // Remove any escaped slashes
          if (!url.includes('ads.khflix.top') && !url.includes('videoAd')) {
            realMp4 = url;
            break;
          }
        }
        
        if (realMp4) {
          setVideoUrl(realMp4);
          setStatus('success');
          return;
        }
      }

      // 4. Check if the input URL itself is a video or a telegram stream
      if (inputType === 'url') {
        const decodedUrl = decodeURIComponent(inputUrl);
        if (inputUrl.includes('.m3u8') || inputUrl.includes('.mp4') || decodedUrl.includes('video/mp4')) {
          if (inputUrl.includes('.m3u8')) {
            setM3u8Url(inputUrl);
          }
          setVideoUrl(inputUrl);
          setStatus('success');
          return;
        }
      }

      // 5. Check for Telegram message links or stream links
      if (inputType === 'url') {
        if (inputUrl.includes('t.me/')) {
          throw new Error("ប្រព័ន្ធមិនអាចទាញយកវីដេអូពីតំណភ្ជាប់ Telegram (t.me) ដោយផ្ទាល់បានទេ ព្រោះវាទាមទារគណនី (Login) ជាពិសេសសម្រាប់ Group/Channel ឯកជន។");
        }
        if (inputUrl.includes('web.telegram.org/k/stream') || inputUrl.includes('web.telegram.org/a/stream')) {
          throw new Error("Link ប្រភេទ Stream របស់ Telegram Web នេះគឺជា Link និម្មិត (Virtual Link) ដែលដំណើរការបានតែក្នុង Tab របស់ Telegram ប៉ុណ្ណោះ។ អ្នកមិនអាចយកវាមកទាញយកនៅទីនេះ ឬបើកនៅ Tab ថ្មីបានទេ។ សូមប្រើវិធី Screen Record លើ Telegram Web ជំនួសវិញ។");
        }
      }

      // 6. Check for Cloudflare challenge
      if (htmlContent.includes('Cloudflare') && htmlContent.includes('Just a moment')) {
        throw new Error("គេហទំព័រនេះត្រូវបានការពារដោយ Cloudflare។ សូមប្រើប្រាស់មុខងារ 'បញ្ចូលកូដដើម (Page Source)' ជំនួសវិញ។");
      }

      throw new Error("រកមិនឃើញ Iframe ឬ Video នៅក្នុងកូដនេះទេ។ គេហទំព័រនេះប្រហែលជាប្រើ JavaScript ដើម្បីលាក់វីដេអូ ឬទាមទារការ Login។ សូមសាកល្បងប្រើមុខងារ 'បញ្ចូលកូដដើម (Page Source)' ឬ Inspect Network ក្នុង Browser របស់អ្នក។");
    } catch (error: any) {
      console.error("Error:", error);
      setErrorMessage(error.message || "មានបញ្ហាក្នុងការទាញយកទិន្នន័យ");
      setStatus('error');
    }
  };

  const [currentPlaylistIndex, setCurrentPlaylistIndex] = useState<number>(0);

  useEffect(() => {
    if (status === 'success' && iframeContainerRef.current) {
      const container = iframeContainerRef.current;
      container.innerHTML = ''; // Clear previous

      if (playlists.length > 0) {
        const currentVideoUrl = playlists[currentPlaylistIndex];
        
        const playerHtml = `
          <!DOCTYPE html>
          <html>
          <head>
              <meta name="referrer" content="no-referrer">
              <style>
                  body { margin: 0; padding: 0; background: #000; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
                  video { width: 100%; height: 100%; outline: none; }
              </style>
          </head>
          <body>
              <video id="video" controls autoplay src="${currentVideoUrl}"></video>
          </body>
          </html>
        `;

        const playerIframe = document.createElement('iframe');
        playerIframe.width = '100%';
        playerIframe.height = '100%';
        playerIframe.frameBorder = '0';
        playerIframe.allowFullscreen = true;
        playerIframe.sandbox.add("allow-scripts", "allow-same-origin", "allow-presentation");
        
        container.appendChild(playerIframe);

        const iframeDoc = playerIframe.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.open();
          iframeDoc.write(playerHtml);
          iframeDoc.close();
        }
      } else if (videoUrl) {
        if (m3u8Url) {
          // We found the m3u8! Use a custom player to play our proxied stream
          const proxyM3u8Url = `/api/proxy-m3u8?url=${encodeURIComponent(m3u8Url)}`;
          
          // We use a simple HTML5 video player with hls.js injected
          const playerHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="referrer" content="no-referrer">
                <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
                <style>
                    body { margin: 0; padding: 0; background: #000; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
                    video { width: 100%; height: 100%; outline: none; }
                </style>
            </head>
            <body>
                <video id="video" controls autoplay></video>
                <script>
                  var video = document.getElementById('video');
                  var videoSrc = '${proxyM3u8Url}';
                  if (Hls.isSupported()) {
                    var hls = new Hls({
                      // Optional: configure hls.js here if needed
                    });
                    hls.loadSource(videoSrc);
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MANIFEST_PARSED, function() {
                      video.play().catch(e => console.log("Auto-play prevented"));
                    });
                  }
                  else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = videoSrc;
                    video.addEventListener('loadedmetadata', function() {
                      video.play().catch(e => console.log("Auto-play prevented"));
                    });
                  }
                </script>
            </body>
            </html>
          `;

          const playerIframe = document.createElement('iframe');
          playerIframe.width = '100%';
          playerIframe.height = '100%';
          playerIframe.frameBorder = '0';
          playerIframe.allowFullscreen = true;
          playerIframe.sandbox.add("allow-scripts", "allow-same-origin", "allow-presentation");
          
          container.appendChild(playerIframe);

          const iframeDoc = playerIframe.contentWindow?.document;
          if (iframeDoc) {
            iframeDoc.open();
            iframeDoc.write(playerHtml);
            iframeDoc.close();
          }

        } else {
          // Fallback to the old iframe proxy method if we couldn't extract m3u8
          const proxyVideoUrl = `/api/proxy-video?url=${encodeURIComponent(videoUrl)}`;

          const protectiveIframe = document.createElement('iframe');
          protectiveIframe.width = '100%';
          protectiveIframe.height = '100%';
          protectiveIframe.frameBorder = '0';
          protectiveIframe.allowFullscreen = true;
          protectiveIframe.sandbox.add("allow-scripts", "allow-same-origin", "allow-presentation");
          
          container.appendChild(protectiveIframe);

          const iframeDoc = protectiveIframe.contentWindow?.document;
          if (iframeDoc) {
            iframeDoc.open();
            iframeDoc.write(`
              <!DOCTYPE html>
              <html>
              <head>
                  <meta name="referrer" content="no-referrer">
                  <style>
                      body { margin: 0; padding: 0; background: #000; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
                      iframe { width: 100%; height: 100%; border: none; }
                  </style>
              </head>
              <body>
                  <iframe src="${proxyVideoUrl}" allowfullscreen="true" webkitallowfullscreen="true" mozallowfullscreen="true" frameborder="0" scrolling="no" referrerpolicy="no-referrer"></iframe>
              </body>
              </html>
            `);
            iframeDoc.close();
          }
        }
      }
    }
  }, [status, videoUrl, m3u8Url, playlists, currentPlaylistIndex]);

  return (
    <div className="bg-gray-100 flex items-center justify-center min-h-screen p-3 sm:p-6 font-sans">
      <div className="bg-white p-4 sm:p-6 md:p-8 rounded-2xl shadow-xl w-full max-w-3xl">
        <h1 className="text-xl sm:text-2xl font-bold mb-2 text-gray-800 flex items-center gap-3">
          <Server className="w-6 h-6 text-indigo-600 flex-shrink-0" />
          <span className="leading-tight">សាកល្បង Advanced HLS Proxy</span>
        </h1>
        <p className="text-sm text-gray-600 mb-5 sm:mb-6">
          ជ្រើសរើសរបៀបបញ្ចូលទិន្នន័យ ដើម្បីស្វែងរកវីដេអូ៖
        </p>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4">
          <button
            onClick={() => setInputType('url')}
            className={`flex-1 py-2.5 px-4 rounded-xl font-semibold transition-all duration-200 ease-in-out ${inputType === 'url' ? 'bg-indigo-100 text-indigo-700 border-2 border-indigo-500 shadow-sm' : 'bg-gray-50 text-gray-600 border-2 border-transparent hover:bg-gray-100'}`}
          >
            បញ្ចូលលីង (URL)
          </button>
          <button
            onClick={() => setInputType('source')}
            className={`flex-1 py-2.5 px-4 rounded-xl font-semibold transition-all duration-200 ease-in-out ${inputType === 'source' ? 'bg-indigo-100 text-indigo-700 border-2 border-indigo-500 shadow-sm' : 'bg-gray-50 text-gray-600 border-2 border-transparent hover:bg-gray-100'}`}
          >
            កូដដើម (Page Source)
          </button>
        </div>

        <div className="mb-5 sm:mb-6">
          {inputType === 'url' ? (
            <input 
              type="text" 
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="w-full p-3.5 sm:p-4 text-sm sm:text-base border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none shadow-sm transition-all"
              placeholder="https://khfullhd.co/..."
              autoCapitalize="off"
              autoCorrect="off"
            />
          ) : (
            <textarea
              value={inputSource}
              onChange={(e) => setInputSource(e.target.value)}
              className="w-full p-3.5 sm:p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono text-xs h-32 sm:h-40 shadow-sm transition-all"
              placeholder="Paste HTML Source Code ទីនេះ (ចុច Ctrl+U នៅលើវេបសាយដើម រួច Copy មក Paste ទីនេះ)..."
            />
          )}
        </div>

        <button
          onClick={handleFetchVideo}
          disabled={status === 'loading' || (inputType === 'url' ? !inputUrl : !inputSource)}
          className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-indigo-400 text-white font-bold py-3.5 px-6 rounded-xl transition duration-200 w-full shadow-md flex items-center justify-center gap-2 text-sm sm:text-base"
        >
          {status === 'loading' ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
              <span>កំពុងទាញយក...</span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5 flex-shrink-0" />
              <span>បង្ខំទាញយក និង Play វីដេអូ</span>
            </>
          )}
        </button>

        {status !== 'idle' && (
          <div className="mt-5 sm:mt-6 animate-fade-in">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">ស្ថានភាព (Status):</h3>
            <div className="p-3 sm:p-4 bg-gray-50 border border-gray-100 rounded-xl text-sm font-mono overflow-auto break-words shadow-inner">
              {status === 'loading' && (
                <span className="text-blue-500 animate-pulse flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" /> 
                  <span>កំពុងទម្លុះយកទិន្នន័យ (Bypassing & Fetching)...</span>
                </span>
              )}
              {status === 'success' && playlists.length > 0 && (
                <div>
                  <span className="text-green-600 font-bold flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> រកឃើញបញ្ជីវីដេអូ (Playlists)៖
                  </span>
                  <div className="flex flex-col gap-2.5 mt-2">
                    {playlists.map((url, index) => (
                      <div key={index} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white p-2 rounded-lg border border-gray-200">
                        <button 
                          onClick={() => setCurrentPlaylistIndex(index)}
                          className={`flex-1 text-left text-xs p-2.5 rounded-lg border transition-colors ${currentPlaylistIndex === index ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-bold shadow-sm' : 'bg-white border-transparent text-gray-700 hover:bg-gray-50'}`}
                        >
                          ភាគទី {index + 1}: <span className="opacity-75 break-all">{url.length > 60 ? url.substring(0, 60) + '...' : url}</span>
                        </button>
                        <button 
                          onClick={() => handleCopy(url)} 
                          className="flex items-center justify-center gap-2 p-2.5 sm:p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 flex-shrink-0 transition-colors" 
                          title="Copy Link"
                        >
                          {copied === url ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                          <span className="sm:hidden text-xs font-semibold">Copy Link</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {status === 'success' && videoUrl && playlists.length === 0 && (
                <div className="space-y-4">
                  <div>
                    <span className="text-green-600 font-bold flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> រកឃើញលីង Iframe ដើម៖
                    </span>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white p-3 rounded-lg border border-gray-200">
                      <a href={videoUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 underline text-xs break-all flex-1">
                        {videoUrl}
                      </a>
                      <button onClick={() => handleCopy(videoUrl)} className="p-2 sm:p-1.5 bg-gray-100 text-gray-600 rounded flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors">
                        {copied === videoUrl ? <Check className="w-4 h-4 sm:w-3 sm:h-3 text-green-600" /> : <Copy className="w-4 h-4 sm:w-3 sm:h-3" />}
                        <span className="sm:hidden text-xs font-semibold">Copy</span>
                      </button>
                    </div>
                  </div>
                  
                  {m3u8Url ? (
                    <div>
                      <span className="text-purple-600 font-bold flex items-center gap-2 mb-2">
                        <Film className="w-5 h-5 flex-shrink-0" /> រកឃើញលីង .m3u8 (Direct Stream)៖
                      </span>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white p-3 rounded-lg border border-gray-200">
                        <span className="text-gray-600 text-xs break-all flex-1">
                          {m3u8Url}
                        </span>
                        <button onClick={() => handleCopy(m3u8Url)} className="p-2 sm:p-1.5 bg-gray-100 text-gray-600 rounded flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors">
                          {copied === m3u8Url ? <Check className="w-4 h-4 sm:w-3 sm:h-3 text-green-600" /> : <Copy className="w-4 h-4 sm:w-3 sm:h-3" />}
                          <span className="sm:hidden text-xs font-semibold">Copy</span>
                        </button>
                      </div>
                      <span className="text-indigo-600 font-bold flex items-center gap-2 mb-1 mt-3">
                        <Server className="w-4 h-4 flex-shrink-0" /> កំពុងបញ្ជូន HLS Stream តាមរយៈ Backend Proxy៖
                      </span>
                      <span className="text-gray-500 text-xs inline-block bg-indigo-50/50 p-2 rounded w-full break-all border border-indigo-100">
                        /api/proxy-m3u8?url=...
                      </span>
                    </div>
                  ) : (
                    <span className="text-orange-500 font-bold flex items-center gap-2 mb-1 mt-2">
                      <AlertCircle className="w-5 h-5 flex-shrink-0" /> មិនអាចទាញយក .m3u8 បានទេ ប្រើប្រាស់ Iframe Proxy ជំនួស។
                    </span>
                  )}
                </div>
              )}
              {status === 'error' && (
                <div>
                  <div className="text-red-500 font-bold mb-2 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" /> បរាជ័យ!
                  </div>
                  <div className="text-red-500 text-sm mb-4 leading-relaxed bg-red-50 p-3 rounded-lg border border-red-100">{errorMessage}</div>
                  
                  <div className="mt-4 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
                    <p className="font-bold text-gray-800 mb-3 text-sm">សូមសាកល្បង Copy Link វីដេអូ (Iframe) មកដាក់ផ្ទាល់៖</p>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        type="text"
                        value={manualIframeUrl}
                        onChange={(e) => setManualIframeUrl(e.target.value)}
                        placeholder="Paste Iframe URL here..."
                        className="flex-1 p-3 border border-gray-200 outline-none focus:ring-2 focus:ring-indigo-500 rounded-lg text-black text-sm"
                        autoCapitalize="off"
                        autoCorrect="off"
                      />
                      <button
                        onClick={() => {
                          if (manualIframeUrl) {
                            setVideoUrl(manualIframeUrl);
                            setStatus('success');
                          }
                        }}
                        className="bg-indigo-600 text-white px-5 py-3 rounded-lg hover:bg-indigo-700 text-sm font-semibold transition-colors shadow-sm"
                      >
                        ចាក់វីដេអូ
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {(() => {
          const downloadTarget = playlists.length > 0 ? playlists[currentPlaylistIndex] : (m3u8Url || videoUrl || '');
          const isTelegram = downloadTarget.includes('web.telegram.org');
          const downloadHref = isTelegram ? downloadTarget : `/api/download-mp4?url=${encodeURIComponent(downloadTarget)}`;
          
          return status === 'success' && downloadTarget && (m3u8Url || (videoUrl && (videoUrl.match(/\.(mp4|webm|ogg)$/i) || decodeURIComponent(videoUrl).includes('video/mp4')))) ? (
            <div className="mt-5 sm:mt-6">
              <a
                href={downloadHref}
                target={isTelegram ? "_blank" : undefined}
                rel="noreferrer"
                download="video.mp4"
                className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold py-3.5 px-6 rounded-xl transition duration-200 w-full shadow-md flex items-center justify-center gap-2 text-sm sm:text-base"
              >
                <Download className="w-5 h-5 flex-shrink-0" />
                <span>ទាញយកវីដេអូ (.mp4)</span>
              </a>
              <p className="text-xs text-gray-500 mt-3 text-center px-2">
                ចំណាំ៖ ការទាញយកវីដេអូពី HLS (.m3u8) អាចចំណាយពេលបន្តិច អាស្រ័យលើទំហំវីដេអូ និងល្បឿនអ៊ីនធឺណិត។
              </p>
            </div>
          ) : null;
        })()}

        {rawHtml && (
          <div className="mt-5">
            <button
              onClick={() => setShowSource(!showSource)}
              className="flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors p-2 -ml-2 rounded-lg hover:bg-indigo-50"
            >
              <Code className="w-4 h-4" />
              {showSource ? 'លាក់កូដដើម (Hide Source)' : 'បង្ហាញកូដដើម (View Page Source)'}
            </button>
            
            {showSource && (
              <div className="mt-3 relative">
                <button 
                  onClick={() => handleCopy(rawHtml)}
                  className="absolute top-2 right-2 p-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white shadow-md z-10"
                  title="Copy Source"
                >
                  {copied === rawHtml ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
                <pre className="bg-gray-900 text-gray-300 p-4 rounded-xl text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all shadow-inner">
                  {rawHtml}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Video Container */}
        <div
          className={`mt-6 w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl flex items-center justify-center text-white relative ${
            status === 'success' ? 'block animate-fade-in' : 'hidden'
          }`}
          ref={iframeContainerRef}
        >
          {/* Iframe will be injected here by useEffect */}
        </div>
        
        {/* Note section */}
        <div className="mt-8 p-4 sm:p-5 bg-indigo-50 border border-indigo-100 rounded-xl text-sm text-indigo-900 shadow-sm">
          <h4 className="font-bold mb-3 flex items-center gap-2 text-indigo-800">
            <Server className="w-5 h-5 flex-shrink-0" /> ព័ត៌មានបច្ចេកទេស (Advanced HLS Proxy)
          </h4>
          <p className="mb-3 leading-relaxed opacity-90">
            ឥឡូវនេះ កម្មវិធីនេះបានបំពាក់នូវប្រព័ន្ធ <strong>Advanced Web Scraping & HLS Proxying</strong>។
          </p>
          <ul className="list-disc pl-5 space-y-2 opacity-90">
            <li><strong>Scraping:</strong> Backend នឹងចូលទៅកាយកូដ HTML/JS របស់ Iframe ដើម ដើម្បីទាញយកលីង <code>.m3u8</code> ពិតប្រាកដ។</li>
            <li><strong>Playlist Proxy:</strong> Backend នឹងទាញយកឯកសារ <code>.m3u8</code> មកកែច្នៃលីងខាងក្នុងទាំងអស់ ឱ្យរត់កាត់ Server របស់យើង។</li>
            <li><strong>Segment Proxy:</strong> រាល់កង់វីដេអូ (<code>.ts</code>) ទាំងអស់ នឹងត្រូវទាញយកដោយ Backend (ដោយភ្ជាប់ Referer ត្រឹមត្រូវ) រួចទើបបញ្ជូនមក Browser។</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
