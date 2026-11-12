export function EmptyState({ children, stage = false }: { children: string; stage?: boolean }) {
  return (
    <div className={stage ? 'empty empty-stage' : 'empty'}>
      {stage ? (
        <span className="empty-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26">
            <path
              d="M7 3.75h6.7L18.5 8.4V19.5A1.25 1.25 0 0 1 17.25 20.75h-10.5A1.25 1.25 0 0 1 5.5 19.5v-14.5A1.25 1.25 0 0 1 6.75 3.75H7Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M13.5 3.9V8.2h4.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </span>
      ) : null}
      <p>{children}</p>
    </div>
  );
}
