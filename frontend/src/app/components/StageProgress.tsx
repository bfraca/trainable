import { statusConfig } from './statusConfig';

export default function StageProgress({ status }: { status: string | null }) {
  const stages = ['EDA', 'Prep', 'Train'];
  const config = status ? statusConfig[status] : null;
  const currentStageIndex = config ? stages.indexOf(config.stage) : -1;
  const isDone = config?.icon === 'done';
  const isFailed = config?.icon === 'failed';

  return (
    <div className="flex items-center space-x-1">
      {stages.map((stage, index) => {
        const isActive = index === currentStageIndex;
        const isComplete = index < currentStageIndex || (isDone && index === currentStageIndex);
        const hasFailed = isFailed && index === currentStageIndex;
        return (
          <div key={stage} className="flex items-center">
            <div
              className={`w-2 h-2 rounded-full transition-all ${
                hasFailed
                  ? 'bg-red-500'
                  : isComplete
                    ? 'bg-emerald-500'
                    : isActive
                      ? 'bg-blue-500 animate-pulse'
                      : 'bg-neutral-600'
              }`}
            />
            {index < stages.length - 1 && (
              <div className={`w-4 h-0.5 ${isComplete ? 'bg-emerald-500' : 'bg-neutral-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
