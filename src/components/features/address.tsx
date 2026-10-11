'use client';

import { Text } from '@/components/ui/localized-text';

import { MapPin } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/ui/field';
import { useApi } from '@/lib/hooks';

interface AddressOptions {
  precincts: { precinct: string | null; streets: string[] }[];
}
interface HomeOption {
  id: string;
  label: string;
  address: string;
}

/**
 * Choose a home from the township's property record: precinct (or phase), then
 * street, then house or unit. Choosing rather than typing means the address
 * always matches what the township office checks. Submits the home as `homeId`.
 * Give it `key={townshipId}` so it starts again when the township changes.
 */
export function AddressPicker({ townshipId, error }: { townshipId: string | null; error?: string }) {
  const options = useApi<AddressOptions>(townshipId ? `/townships/${townshipId}/addresses` : null);
  const groups = options.data?.precincts ?? [];
  // Townships without precincts skip that step.
  const askPrecinct = groups.length > 1 || (groups.length === 1 && groups[0]!.precinct !== null);
  const [precinct, setPrecinct] = useState<string | null>(null);
  const [street, setStreet] = useState('');
  const [homeId, setHomeId] = useState('');

  const group = askPrecinct ? groups.find((g) => g.precinct === precinct) : groups[0];
  const query = group && street ? `?street=${encodeURIComponent(street)}${group.precinct ? `&precinct=${encodeURIComponent(group.precinct)}` : ''}` : null;
  const homes = useApi<HomeOption[]>(townshipId && query ? `/townships/${townshipId}/homes${query}` : null);
  const chosen = homes.data?.find((h) => h.id === homeId);

  if (!townshipId) {
    return (
      <Select label="Address" disabled defaultValue="" error={error}>
        <option value=""><Text>Choose your township first</Text></option>
      </Select>
    );
  }
  return (
    <fieldset className="space-y-4">
      <legend className="sr-only"><Text>Your address</Text></legend>
      <div className={askPrecinct ? 'grid gap-4 sm:grid-cols-2' : undefined}>
        {askPrecinct && (
          <Select
            label="Precinct or phase"
            value={precinct ?? ''}
            onChange={(event) => {
              setPrecinct(event.target.value);
              setStreet('');
              setHomeId('');
            }}
            required
          >
            <option value="" disabled>
              <Text>{options.data ? 'Choose' : 'Loading…'}</Text>
            </option>
            {groups.map((g) => (
              <option key={g.precinct ?? ''} value={g.precinct ?? ''}>
                <Text>{g.precinct}</Text>
              </option>
            ))}
          </Select>
        )}
        <Select
          label="Street"
          value={street}
          disabled={!group}
          onChange={(event) => {
            setStreet(event.target.value);
            setHomeId('');
          }}
          required
        >
          <option value="" disabled>
            <Text>{group ? 'Choose' : askPrecinct ? 'Choose a precinct first' : 'Loading…'}</Text>
          </option>
          {group?.streets.map((s) => (
            <option key={s} value={s}>
              <Text>{s}</Text>
            </option>
          ))}
        </Select>
      </div>
      <Select
        label="House or unit number"
        name="homeId"
        value={homeId}
        disabled={!street}
        onChange={(event) => setHomeId(event.target.value)}
        required
        error={error}
        hint="Cannot find your address? The township office adds homes from the property record."
      >
        <option value="" disabled>
          <Text>{!street ? 'Choose a street first' : homes.data ? 'Choose' : 'Loading…'}</Text>
        </option>
        {homes.data?.map((h) => (
          <option key={h.id} value={h.id}>
            <Text>{h.label}</Text>
          </option>
        ))}
      </Select>
      {chosen && (
        <p className="flex items-start gap-2 rounded-md border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{chosen.address}</span>
        </p>
      )}
    </fieldset>
  );
}
