'use client';

import ReactMarkdown from 'react-markdown';
import { FileText } from 'lucide-react';

interface ReportTabProps {
  report: string;
}

export default function ReportTab({ report }: ReportTabProps) {
  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <FileText className="w-12 h-12 mb-3 text-gray-600" />
        <p className="text-sm">Report will appear here when the agent starts working</p>
      </div>
    );
  }

  return (
    <div className="p-6 markdown-content max-w-none">
      <ReactMarkdown>{report}</ReactMarkdown>
    </div>
  );
}
