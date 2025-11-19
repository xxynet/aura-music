import React, { useState } from 'react';
import { analyzeLyrics } from '../services/geminiService';
import { Song } from '../types';

interface GeminiButtonProps {
  song: Song;
}

const GeminiButton: React.FC<GeminiButtonProps> = ({ song }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ vibe: string; meanings: string[] } | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleAnalyze = async () => {
    if (data) {
        setIsOpen(true);
        return;
    }
    if (!song.lyrics || song.lyrics.length === 0) return;
    
    setLoading(true);
    setIsOpen(true);
    
    // Convert lyrics array back to string
    const fullText = song.lyrics.map(l => l.text).join('\n');
    
    const result = await analyzeLyrics(song.title, song.artist, fullText);
    setData(result);
    setLoading(false);
  };

  if (!song.lyrics || song.lyrics.length === 0) return null;

  return (
    <>
      <button
        onClick={handleAnalyze}
        className="fixed bottom-8 right-8 z-50 flex items-center gap-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white px-4 py-2 rounded-full shadow-lg shadow-purple-500/40 hover:scale-105 transition-all font-medium text-sm"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813a3.75 3.75 0 002.576-2.576l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5z" clipRule="evenodd" />
        </svg>
        {loading ? 'Analyzing...' : 'AI Vibe Check'}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
          <div className="bg-gray-900 border border-white/10 p-6 rounded-2xl max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            {loading ? (
              <div className="flex flex-col items-center text-white/70 gap-4">
                 <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                 <p>Consulting the music spirits...</p>
              </div>
            ) : data ? (
              <div className="text-white space-y-4">
                <h3 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-pink-400">Vibe Check</h3>
                <p className="text-lg italic text-white/90">"{data.vibe}"</p>
                <div className="w-full h-px bg-white/10"></div>
                <h4 className="font-semibold text-white/60 uppercase text-xs tracking-wider">Interpretation</h4>
                <ul className="space-y-2">
                  {data.meanings?.map((m, i) => (
                    <li key={i} className="flex gap-2 text-white/80">
                      <span className="text-purple-400">•</span> {m}
                    </li>
                  ))}
                </ul>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="mt-4 w-full py-2 bg-white/10 hover:bg-white/20 rounded-lg font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
               <div className="text-red-400">Failed to analyze. Try again.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default GeminiButton;