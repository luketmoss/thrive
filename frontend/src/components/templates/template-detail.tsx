import { useState } from 'preact/hooks';
import { templates, activeWorkoutId, showToast } from '../../state/store';
import { removeTemplate, startWorkout } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
import { ExerciseCompactCard } from '../shared/exercise-compact-card';

interface Props {
  templateId: string;
}

export function TemplateDetail({ templateId }: Props) {
  const { token } = useAuth();
  const tpl = templates.value.find((t) => t.id === templateId);
  const [deleting, setDeleting] = useState(false);
  const [starting, setStarting] = useState(false);

  if (!tpl) {
    return (
      <div class="screen">
        <div class="empty-state">
          <p>Template not found</p>
          <button class="btn btn-primary" onClick={() => navigate('/templates')}>Back to Templates</button>
        </div>
      </div>
    );
  }

  const handleDelete = async () => {
    if (!token) return;
    if (!confirm('Delete this template? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await removeTemplate(templateId, tpl.exercises, token);
      navigate('/templates');
    } catch {
      // Error toast shown by action
    } finally {
      setDeleting(false);
    }
  };

  const handleStartWorkout = async () => {
    if (!token || starting) return;
    if (activeWorkoutId.value) {
      showToast('Finish your current workout before starting a new one', 'error');
      return;
    }
    setStarting(true);
    try {
      const id = await startWorkout(
        { type: 'weight', name: tpl.name, template_id: tpl.id },
        token,
      );
      navigate(`/workout/${id}`);
    } catch {
      // Error toast shown by action
    } finally {
      setStarting(false);
    }
  };

  return (
    <div class="screen template-detail-screen">
      <div class="template-editor-header">
        <button
          class="template-editor-back"
          onClick={() => navigate('/templates')}
          aria-label="Back"
        >
          ← Back
        </button>
        <button
          class="btn btn-primary btn-sm"
          onClick={() => navigate(`/templates/${templateId}/edit`)}
        >
          Edit
        </button>
      </div>

      <h2 class="detail-title" style={{ marginBottom: 'var(--space-md)' }}>{tpl.name}</h2>

      <div class="compact-card-list">
        {tpl.exercises.map((ex, i) => (
          <div key={`${ex.exercise_id}-${i}`}>
            <ExerciseCompactCard
              section={ex.section as string}
              exerciseName={ex.exercise_name}
              sets={ex.sets}
              reps={ex.reps}
            />
          </div>
        ))}
      </div>

      <div class="template-detail-footer">
        <button
          class="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleStartWorkout}
          disabled={starting || deleting}
        >
          {starting ? 'Starting...' : 'Start Workout'}
        </button>
        <button
          class="btn btn-danger"
          style={{ width: '100%', marginTop: 'var(--space-md)' }}
          onClick={handleDelete}
          disabled={deleting || starting}
        >
          {deleting ? 'Deleting...' : 'Delete Template'}
        </button>
      </div>
    </div>
  );
}
