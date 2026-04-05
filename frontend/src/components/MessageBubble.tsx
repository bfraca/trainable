'use client';

import { Bot, User } from 'lucide-react';

interface MessageBubbleProps {
  role: string;
  content: string;
}

export default function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex gap-2.5 animate-slide-up ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-primary-500/20' : 'bg-emerald-500/20'
        }`}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-primary-400" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-emerald-400" />
        )}
      </div>
      <div
        className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-primary-600 text-white rounded-br-md'
            : 'bg-surface-elevated text-gray-200 border border-surface-border rounded-bl-md'
        }`}
      >
        {content}
      </div>
    </div>
  );
}
