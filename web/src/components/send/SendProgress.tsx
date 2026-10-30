import { Spinner } from '../common/Spinner';

export function SendProgress({ text }: { text: string }) {
  return (
    <div className="help">
      <Spinner /> {text}
    </div>
  );
}
