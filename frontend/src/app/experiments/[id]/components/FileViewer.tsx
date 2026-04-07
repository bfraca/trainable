'use client';

import { useState, useEffect } from 'react';
import { Loader2, Cpu } from 'lucide-react';
import { api } from '@/lib/api';
import { getBackendUrl } from '../utils/helpers';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('json', json);

export default function FileViewer({ filePath, sessionId }: { filePath: string; sessionId: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = filePath.split('/').pop() || '';
  const isImage = /\.(png|jpg|jpeg|svg|gif)$/i.test(fileName);
  const isPython = fileName.endsWith('.py');
  const isMarkdown = fileName.endsWith('.md');
  const isJSON = fileName.endsWith('.json');
  const isBinary = /\.(pkl|joblib|parquet|h5|hdf5|pt|pth|onnx)$/i.test(fileName);

  useEffect(() => {
    if (isImage || isBinary) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .readFile(filePath)
      .then((res) => {
        setContent(res.content);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [filePath]);

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-400">{error}</div>
        ) : isImage ? (
          <div className="p-6 flex items-center justify-center bg-[#0d1117]">
            <img
              src={`${getBackendUrl()}/api/files/raw?path=${encodeURIComponent(filePath)}`}
              alt={fileName}
              className="max-w-full max-h-[60vh] rounded-lg"
            />
          </div>
        ) : isBinary ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <Cpu className="w-8 h-8 mb-2" />
            <p className="text-sm">Binary file</p>
            <p className="text-xs text-gray-600 mt-1">{fileName}</p>
          </div>
        ) : isPython || isJSON ? (
          <SyntaxHighlighter
            language={isPython ? 'python' : 'json'}
            style={oneDark}
            customStyle={{
              margin: 0,
              padding: '16px',
              background: '#0d1117',
              fontSize: '13px',
              lineHeight: '1.6',
            }}
            showLineNumbers
            lineNumberStyle={{
              color: '#3b4048',
              fontSize: '12px',
              paddingRight: '16px',
              minWidth: '2.5em',
            }}
          >
            {content || ''}
          </SyntaxHighlighter>
        ) : isMarkdown ? (
          <div className="p-6 markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ src, alt }) => {
                  let imgSrc = src || '';
                  if (imgSrc.startsWith('/data/')) {
                    imgSrc = `${getBackendUrl()}/api/files/raw?path=${encodeURIComponent(imgSrc)}`;
                  } else if (imgSrc && !imgSrc.startsWith('http')) {
                    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
                    imgSrc = `${getBackendUrl()}/api/files/raw?path=${encodeURIComponent(dir + '/' + imgSrc)}`;
                  }
                  return (
                    <img
                      src={imgSrc}
                      alt={alt || ''}
                      className="max-w-full rounded-lg shadow-md my-4"
                    />
                  );
                },
              }}
            >
              {content || ''}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className="p-4 text-[13px] text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
            {content || ''}
          </pre>
        )}
      </div>
    </div>
  );
}
