import { toasts } from '../../state/store';

export function Toast() {
  if (toasts.value.length === 0) return null;

  return (
    <div class="toast-container">
      {toasts.value.map(t => (
        <div key={t.id} class={`toast toast-${t.type}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
