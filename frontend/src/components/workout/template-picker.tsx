import { templates } from '../../state/store';

interface Props {
  onSelectTemplate: (templateId: string) => void;
  onBuildCustom: () => void;
  onBack: () => void;
}

export function TemplatePicker({ onSelectTemplate, onBuildCustom, onBack }: Props) {
  return (
    <div class="screen template-picker-screen">
      <div class="template-editor-header">
        <button
          class="template-editor-back"
          onClick={onBack}
          aria-label="Back"
        >
          ← Back
        </button>
      </div>

      <h2 style={{ marginBottom: 'var(--space-lg)' }}>Choose a template</h2>

      <div class="screen-body">
        <button
          class="template-card"
          onClick={onBuildCustom}
        >
          <div class="template-card-body">
            <span class="template-name">Build Custom</span>
            <span class="template-summary">Start with an empty workout</span>
          </div>
        </button>

        {templates.value.map((tpl) => (
          <button
            key={tpl.id}
            class="template-card"
            onClick={() => onSelectTemplate(tpl.id)}
          >
            <div class="template-card-body">
              <span class="template-name">{tpl.name}</span>
              <span class="template-summary">
                {tpl.exercises.length} exercise{tpl.exercises.length !== 1 ? 's' : ''}
              </span>
            </div>
          </button>
        ))}

        {templates.value.length === 0 && (
          <div class="empty-state">
            <p>No templates yet</p>
            <p>Create templates in the Templates tab, or build a custom workout</p>
          </div>
        )}
      </div>
    </div>
  );
}
