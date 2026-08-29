import { useCallback, useEffect, useRef, useState } from 'react';

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useComposerSpeechInput(options: {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  lang?: string;
}) {
  const { onTranscript, onError, lang = 'en-US' } = options;
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const [listening, setListening] = useState(false);
  const supported = getSpeechRecognitionCtor() != null;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      onError?.('Speech recognition is not supported in this browser.');
      return;
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;

    let sessionText = '';

    r.onresult = (event) => {
      let chunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        chunk += event.results[i][0].transcript;
      }
      if (chunk) sessionText = chunk;
    };

    r.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      const trimmed = sessionText.trim();
      if (trimmed) onTranscript(trimmed);
    };

    r.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
      onError?.('Microphone error — check browser permissions.');
    };

    recognitionRef.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
      recognitionRef.current = null;
      onError?.('Could not start microphone.');
    }
  }, [lang, listening, onError, onTranscript]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  return { supported, listening, toggle, stop };
}
