import { templates } from '../../state/store';
import { navigate } from '../../router/router';
import { currentRoute } from '../../router/router';
import { TemplateEditor } from './template-editor';

function sectionSummary(tpl: { exercises: Array<{ section: string }> }): string {
  const sections = new Set(tpl.exercises.map((e) => e.section));
  const parts: string[] = [];
  if (sections.has('warmup')) parts.push('Warmup');
  if (sections.has('primary')) parts.push('Primary');
  const ssCount = ['SS1', 'SS2', 'SS3'].filter((s) => sections.has(s)).length;
  if (ssCount > 0) parts.push(`${ssCount} Superset${ssCount > 1 ? 's' : ''}`);
  if (sections.has('burnout')) parts.push('Burnout');
  if (sections.has('cooldown')) parts.push('Cooldown');
  return parts.join(' · ');
}

function TemplateList() {
  return (
    <div class="screen templates-screen">
      <header class="screen-header">
        <h1>Templates</h1>
      </header>
      <div class="screen-body">
        {templates.value.length === 0 ? (
          <div class="empty-state">
            <p>No templates yet</p>
            <p>Create a template to speed up workout logging</p>
          </div>
        ) : (
          <div class="template-list">
            {templates.value.map((t) => (
              <div
                key={t.id}
                class="template-card"
                onClick={() => navigate(`/templates/${t.id}`)}
              >
                <div class="template-card-body">
                  <span class="template-name">{t.name}</span>
                  <span class="template-summary">{sectionSummary(t)}</span>
                </div>
                <span class="template-count">{t.exercises.length} exercises</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button
        class="fab"
        onClick={() => navigate('/templates/new')}
        aria-label="New template"
      >
        +
      </button>
    </div>
  );
}

export function TemplatesScreen() {
  const route = currentRoute.value;

  switch (route.name) {
    case 'template-new':
      return <TemplateEditor />;
    case 'template-edit':
      return <TemplateEditor templateId={route.params.id} />;
    default:
      return <TemplateList />;
  }
}
