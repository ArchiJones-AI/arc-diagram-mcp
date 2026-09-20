import type { ReactNode } from 'react';
import type { FlowStep } from './model';

interface StepsPanelProps {
  steps: FlowStep[];
  activeStepNo?: number;
  onStepSelect(stepNo: number): void;
}

function renderBoldMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${index}-${part}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${index}-${part}`}>{part}</span>;
  });
}

export function StepsPanel({ steps, activeStepNo, onStepSelect }: StepsPanelProps) {
  return (
    <section className="dg-steps-panel" aria-label="Runtime narrative">
      <header>
        <span>RUNTIME NARRATIVE</span>
        <h2>{steps.length} steps</h2>
      </header>
      <ol>
        {steps.map((step) => (
          <li key={step.n}>
            <button
              className={activeStepNo === step.n ? 'is-active' : ''}
              type="button"
              aria-pressed={activeStepNo === step.n}
              onClick={() => onStepSelect(step.n)}
            >
              <span className="dg-step-number">{step.n}</span>
              <span className="dg-step-text">{renderBoldMarkdown(step.text)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
