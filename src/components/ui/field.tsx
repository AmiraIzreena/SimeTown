import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
}

/** Label, control, hint and error wired together for screen readers. */
function Shell({ label, hint, error, className, id, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-note`} role="alert" className="text-sm font-medium text-accent-600">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-note`} className="text-sm text-ink-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const noteProps = (id: string, hint: unknown, error?: string) => ({
  id,
  'aria-invalid': error ? true : undefined,
  'aria-describedby': hint || error ? `${id}-note` : undefined,
});

export function Input({ label, hint, error, className, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Shell {...{ label, hint, error, className, id }}>
      <input className="control" {...noteProps(id, hint, error)} {...rest} />
    </Shell>
  );
}

export function Select({ label, hint, error, className, children, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <Shell {...{ label, hint, error, className, id }}>
      <select className="control pr-9" {...noteProps(id, hint, error)} {...rest}>
        {children}
      </select>
    </Shell>
  );
}

/** A tick box whose label may contain links, such as "I accept the Terms". */
export function Checkbox({ label, error, className, ...rest }: { label: ReactNode; error?: string; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-start gap-3">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 cursor-pointer accent-brand-700" {...noteProps(id, undefined, error)} {...rest} />
        <label htmlFor={id} className="text-sm leading-relaxed text-ink-700">
          {label}
        </label>
      </div>
      {error && (
        <p id={`${id}-note`} role="alert" className="text-sm font-medium text-accent-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function Textarea({ label, hint, error, className, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Shell {...{ label, hint, error, className, id }}>
      <textarea className="control min-h-24 py-2.5" rows={3} {...noteProps(id, hint, error)} {...rest} />
    </Shell>
  );
}
