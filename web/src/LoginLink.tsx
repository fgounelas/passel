/** Ephemeral prompt text, never part of saved history or pins. */
export function LoginLink({url}: {url: string}) {
  return <article className="conversation-message" data-role="assistant" aria-label="Claude sign-in">
    <header><strong>Claude</strong></header>
    <p>Open this link to sign in:</p>
    <p><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></p>
    <p>If Claude asks for a code, paste it in Terminal.</p>
  </article>;
}
