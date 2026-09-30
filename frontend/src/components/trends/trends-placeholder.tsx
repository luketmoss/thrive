/** Stand-in for the Trends screen (#242 replaces it). No fake chart. */
export function TrendsPlaceholder() {
  return (
    <div class="screen trends-screen">
      <header class="screen-header">
        <h1>Trends</h1>
      </header>
      <div class="screen-body">
        <p class="placeholder-copy">Trends are on their way.</p>
      </div>
    </div>
  );
}
