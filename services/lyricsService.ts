import { formatTime, fetchViaProxy } from './utils';

const LYRIC_API_BASE = 'https://163api.qijieya.cn';
const METING_API = 'https://api.injahow.cn/meting/';
const NETEASE_SEARCH_API = 'http://music.163.com/api/search/get/web';
const NETEASE_API_BASE = 'http://music.163.com/api';

export const getNeteaseAudioUrl = (id: string) => {
    return `${METING_API}?type=url&id=${id}`;
};

// Implements the search logic from the user provided code snippet
export const searchNetEase = async (keyword: string, limit: number = 20): Promise<any[]> => {
    const searchApiUrl = `${NETEASE_SEARCH_API}?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=1&offset=0&total=true&limit=${limit}`;
    
    try {
        // Use proxy since we are in browser
        const parsedSearchApiResponse = await fetchViaProxy(searchApiUrl);
        const searchData = parsedSearchApiResponse.result;

        if (!searchData || !searchData.songs || searchData.songs.length === 0) {
          return [];
        }

        return searchData.songs.map((song: any) => {
          return {
            id: song.id.toString(),
            title: song.name,
            artist: song.artists.map((artist: any) => artist.name).join('/'),
            album: song.album.name,
            coverUrl: song.album.picUrl, // Use if available, though standard search sometimes omits high res
            duration: song.duration,
            isNetease: true,
            neteaseId: song.id.toString()
          };
        });
    } catch (error) {
        console.error('NetEase search error', error);
        return [];
    }
};

export const fetchNeteasePlaylist = async (playlistId: string) => {
    try {
        const url = `${NETEASE_API_BASE}/playlist/detail?id=${playlistId}`;
        const data = await fetchViaProxy(url);
        if (data.code === 200 && data.result && data.result.tracks) {
            return data.result.tracks.map((track: any) => ({
                id: track.id.toString(),
                title: track.name,
                artist: track.artists.map((a: any) => a.name).join('/'),
                album: track.album.name,
                coverUrl: track.album.picUrl,
                isNetease: true,
                neteaseId: track.id.toString()
            }));
        }
        return [];
    } catch (e) {
        console.error("Playlist fetch error", e);
        return [];
    }
};

export const fetchNeteaseSong = async (songId: string) => {
    try {
        const url = `${NETEASE_API_BASE}/song/detail?id=${songId}&ids=[${songId}]`;
        const data = await fetchViaProxy(url);
        if (data.code === 200 && data.songs && data.songs.length > 0) {
            const track = data.songs[0];
             return {
                id: track.id.toString(),
                title: track.name,
                artist: track.artists.map((a: any) => a.name).join('/'),
                album: track.album.name,
                coverUrl: track.album.picUrl,
                isNetease: true,
                neteaseId: track.id.toString()
            };
        }
        return null;
    } catch (e) {
        console.error("Song fetch error", e);
        return null;
    }
};

// Keeps the old search for lyric matching fallbacks
export const searchAndMatchLyrics = async (title: string, artist: string): Promise<string | null> => {
  try {
    // 1. Search for the song ID using the new Netease Search logic (it's more reliable for IDs)
    const songs = await searchNetEase(`${title} ${artist}`, 5);

    if (songs.length === 0) {
      console.warn("No songs found on Cloud");
      return null;
    }

    const songId = songs[0].id;
    console.log(`Found Song ID: ${songId}`);

    return await fetchLyricsById(songId);

  } catch (error) {
    console.error("Cloud lyrics match failed:", error);
    return null;
  }
};

export const fetchLyricsById = async (songId: string): Promise<string | null> => {
    try {
        // 2. Fetch Lyrics (New Endpoint for YRC support)
        const lyricUrl = `${LYRIC_API_BASE}/lyric/new?id=${songId}`;
        const lyricData = await fetchViaProxy(lyricUrl);

        const yrc = lyricData.yrc?.lyric;
        const lrc = lyricData.lrc?.lyric;
        const tLrc = lyricData.tlyric?.lyric; 

        let finalLrc = yrc || lrc;

        if (!finalLrc) return null;

        // Prepend Metadata if available
        const metadataLines: string[] = [];
        if (lyricData.lyricUser?.nickname) {
            metadataLines.push(`[00:00.000] 歌词贡献者: ${lyricData.lyricUser.nickname}`);
        }
        if (lyricData.transUser?.nickname) {
            metadataLines.push(`[00:00.000] 翻译贡献者: ${lyricData.transUser.nickname}`);
        }

        if (tLrc) {
            finalLrc = finalLrc + '\n' + tLrc;
        }

        if (metadataLines.length > 0) {
            finalLrc = metadataLines.join('\n') + '\n' + finalLrc;
        }

        return finalLrc;
    } catch(e) {
        console.error("Lyric fetch error", e);
        return null;
    }
}
