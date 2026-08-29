import { useEffect, useMemo, useState } from 'react';
import type { Lesson } from '../learn.types';

type MarkdownState = {
  loading: boolean;
  error: string | null;
  markdown: string;
  source: 'content_text' | 'content_url' | 'none';
};

export function useLessonMarkdown(lesson: Lesson | null): MarkdownState {
  const contentText = useMemo(() => (lesson?.content_text ? String(lesson.content_text) : ''), [lesson?.content_text]);
  const contentUrl = useMemo(() => (lesson?.content_url ? String(lesson.content_url) : ''), [lesson?.content_url]);

  const [state, setState] = useState<MarkdownState>(() => ({
    loading: false,
    error: null,
    markdown: contentText,
    source: contentText ? 'content_text' : contentUrl ? 'content_url' : 'none',
  }));

  useEffect(() => {
    if (!lesson) {
      setState({ loading: false, error: null, markdown: '', source: 'none' });
      return;
    }

    if (contentText && contentText.trim()) {
      setState({ loading: false, error: null, markdown: contentText, source: 'content_text' });
      return;
    }

    if (!contentUrl || !contentUrl.trim()) {
      setState({ loading: false, error: null, markdown: '', source: 'none' });
      return;
    }

    const controller = new AbortController();
    setState((p) => ({ ...p, loading: true, error: null, markdown: '', source: 'content_url' }));

    fetch(contentUrl, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((txt) => {
        setState({ loading: false, error: null, markdown: String(txt || ''), source: 'content_url' });
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setState({ loading: false, error: e?.message || 'Failed to load lesson content', markdown: '', source: 'content_url' });
      });

    return () => controller.abort();
  }, [lesson?.id, contentText, contentUrl]);

  return state;
}

