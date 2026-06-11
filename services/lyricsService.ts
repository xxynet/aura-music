import { fetchViaProxy } from "./utils";

const NETEASE_API = "/api/netease";
const METING_API = "https://api.qijieya.cn/meting/";

const METADATA_KEYWORDS = [
  "歌词贡献者",
  "翻译贡献者",
  "作词",
  "作曲",
  "编曲",
  "制作",
  "词曲",
  "词 / 曲",
  "lyricist",
  "composer",
  "arrange",
  "translation",
  "translator",
  "producer",
];

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const metadataKeywordRegex = new RegExp(
  `^(${METADATA_KEYWORDS.map(escapeRegex).join("|")})\\s*[:：]`,
  "iu",
);

const TIMESTAMP_REGEX = /^\[(\d{2}):(\d{2})[\.:](\d{2,3})\](.*)$/;

interface NeteaseApiArtist {
  name?: string;
}

interface NeteaseApiAlbum {
  name?: string;
  picUrl?: string;
}

interface NeteaseApiSong {
  id: number;
  name?: string;
  ar?: NeteaseApiArtist[];
  al?: NeteaseApiAlbum;
  dt?: number;
}

interface NeteaseSearchResponse {
  result?: {
    songs?: NeteaseApiSong[];
  };
}

interface NeteaseSongDetailResponse {
  code?: number;
  songs?: NeteaseApiSong[];
}

export interface NeteaseTrackInfo {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl?: string;
  duration?: number;
  isNetease: true;
  neteaseId: string;
}

type SearchOptions = {
  limit?: number;
  offset?: number;
};

const formatArtists = (artists?: NeteaseApiArtist[]) =>
  (artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter(Boolean)
    .join("/") || "";

const mapNeteaseSongToTrack = (song: NeteaseApiSong): NeteaseTrackInfo => ({
  id: song.id.toString(),
  title: song.name?.trim() ?? "",
  artist: formatArtists(song.ar),
  album: song.al?.name?.trim() ?? "",
  coverUrl: song.al?.picUrl?.replaceAll("http:", "https:"),
  duration: song.dt,
  isNetease: true,
  neteaseId: song.id.toString(),
});

const isMetadataTimestampLine = (line: string): boolean => {
  const trimmed = line.trim();
  const match = trimmed.match(TIMESTAMP_REGEX);
  if (!match) return false;
  const content = match[4].trim();
  return metadataKeywordRegex.test(content);
};

const parseTimestampMetadata = (line: string) => {
  const match = line.trim().match(TIMESTAMP_REGEX);
  return match ? match[4].trim() : line.trim();
};

const isMetadataJsonLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const json = JSON.parse(trimmed);
    if (json.c && Array.isArray(json.c)) {
      const content = json.c.map((item: any) => item.tx || "").join("");
      return metadataKeywordRegex.test(content);
    }
  } catch {
    // ignore invalid json
  }
  return false;
};

const parseJsonMetadata = (line: string) => {
  try {
    const json = JSON.parse(line.trim());
    if (json.c && Array.isArray(json.c)) {
      return json.c
        .map((item: any) => item.tx || "")
        .join("")
        .trim();
    }
  } catch {
    // ignore
  }
  return line.trim();
};

const extractMetadataLines = (content: string) => {
  const metadataSet = new Set<string>();
  const bodyLines: string[] = [];

  content.split("\n").forEach((line) => {
    if (!line.trim()) return;
    if (isMetadataTimestampLine(line)) {
      metadataSet.add(parseTimestampMetadata(line));
    } else if (isMetadataJsonLine(line)) {
      metadataSet.add(parseJsonMetadata(line));
    } else {
      bodyLines.push(line);
    }
  });

  return {
    clean: bodyLines.join("\n").trim(),
    metadata: Array.from(metadataSet),
  };
};

export const getNeteaseAudioUrl = (id: string) => {
  return `${METING_API}?type=url&id=${id}`;
};

// Implements the search logic from the user provided code snippet
export const searchNetEase = async (
  keyword: string,
  options: SearchOptions = {},
): Promise<NeteaseTrackInfo[]> => {
  const { limit = 20, offset = 0 } = options;
  const searchApiUrl = `${NETEASE_API}/search?keywords=${encodeURIComponent(
    keyword,
  )}&limit=${limit}&offset=${offset}`;

  try {
    const parsedSearchApiResponse = (await fetchViaProxy(
      searchApiUrl,
    )) as NeteaseSearchResponse;
    const songs = parsedSearchApiResponse.result?.songs ?? [];

    if (songs.length === 0) {
      return [];
    }

    return songs.map(mapNeteaseSongToTrack);
  } catch (error) {
    console.error("NetEase search error", error);
    return [];
  }
};

export const fetchNeteasePlaylist = async (
  playlistId: string,
): Promise<NeteaseTrackInfo[]> => {
  try {
    // Official API returns playlist.tracks (first ~1000) + playlist.trackIds (all)
    const url = `${NETEASE_API}/playlist?id=${playlistId}`;
    const data = await fetchViaProxy(url);
    const playlist = data.playlist;
    if (!playlist) return [];

    const tracks: NeteaseTrackInfo[] = (playlist.tracks ?? []).map(mapNeteaseSongToTrack);
    const allIds: number[] = (playlist.trackIds ?? []).map((t: any) => t.id);

    // If there are IDs beyond the first batch, fetch their details
    const firstBatchIds = new Set(tracks.map(t => Number(t.id)));
    const remainingIds = allIds.filter(id => !firstBatchIds.has(id));

    for (let i = 0; i < remainingIds.length; i += 50) {
      const batch = remainingIds.slice(i, i + 50);
      const songUrl = `${NETEASE_API}/song?ids=[${batch.join(",")}]`;
      const songData = await fetchViaProxy(songUrl);
      const songs = songData.songs ?? [];
      tracks.push(...songs.map(mapNeteaseSongToTrack));
    }

    return tracks;
  } catch (e) {
    console.error("Playlist fetch error", e);
    return [];
  }
};

export const fetchNeteaseSong = async (
  songId: string,
): Promise<NeteaseTrackInfo | null> => {
  try {
    const url = `${NETEASE_API}/song?ids=[${songId}]`;
    const data = await fetchViaProxy(url) as NeteaseSongDetailResponse;
    const track = data.songs?.[0];
    if (data.code === 200 && track) {
      return mapNeteaseSongToTrack(track);
    }
    return null;
  } catch (e) {
    console.error("Song fetch error", e);
    return null;
  }
};

// Keeps the old search for lyric matching fallbacks
export const searchAndMatchLyrics = async (
  title: string,
  artist: string,
): Promise<{ lrc: string; yrc?: string; tLrc?: string; metadata: string[] } | null> => {
  try {
    const songs = await searchNetEase(`${title} ${artist}`, { limit: 5 });

    if (songs.length === 0) {
      console.warn("No songs found on Cloud");
      return null;
    }

    const songId = songs[0].id;
    console.log(`Found Song ID: ${songId}`);

    const lyricsResult = await fetchLyricsById(songId);
    return lyricsResult;
  } catch (error) {
    console.error("Cloud lyrics match failed:", error);
    return null;
  }
};

export const fetchLyricsById = async (
  songId: string,
): Promise<{ lrc: string; yrc?: string; tLrc?: string; metadata: string[] } | null> => {
  try {
    // Official Netease lyrics API
    const lyricUrl = `${NETEASE_API}/lyric?id=${songId}`;
    const lyricData = await fetchViaProxy(lyricUrl);

    const rawYrc = lyricData.yrc?.lyric;
    const rawLrc = lyricData.lrc?.lyric;
    const tLrc = lyricData.tlyric?.lyric;

    if (!rawYrc && !rawLrc) return null;

    const {
      clean: cleanLrc,
      metadata: lrcMetadata,
    } = rawLrc
        ? extractMetadataLines(rawLrc)
        : { clean: undefined, metadata: [] };

    const {
      clean: cleanYrc,
      metadata: yrcMetadata,
    } = rawYrc
        ? extractMetadataLines(rawYrc)
        : { clean: undefined, metadata: [] };

    // Extract metadata from translation if available
    let cleanTranslation: string | undefined;
    let translationMetadata: string[] = [];
    if (tLrc) {
      const result = extractMetadataLines(tLrc);
      cleanTranslation = result.clean;
      translationMetadata = result.metadata;
    }

    const metadataSet = Array.from(
      new Set([...lrcMetadata, ...yrcMetadata, ...translationMetadata]),
    );

    if (lyricData.transUser?.nickname) {
      metadataSet.unshift(`翻译贡献者: ${lyricData.transUser.nickname}`);
    }

    if (lyricData.lyricUser?.nickname) {
      metadataSet.unshift(`歌词贡献者: ${lyricData.lyricUser.nickname}`);
    }

    const baseLyrics = cleanLrc || cleanYrc || rawLrc || rawYrc;
    if (!baseLyrics) return null;

    const yrcForEnrichment = cleanYrc && cleanLrc ? cleanYrc : undefined;
    return {
      lrc: baseLyrics,
      yrc: yrcForEnrichment,
      tLrc: cleanTranslation,
      metadata: Array.from(metadataSet),
    };
  } catch (e) {
    console.error("Lyric fetch error", e);
    return null;
  }
};
