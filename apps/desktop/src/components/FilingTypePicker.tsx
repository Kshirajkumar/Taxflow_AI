import React from 'react';
import { fetchFilingTypes, fetchSupportedCountries, FilingType, SupportedCountry } from '../lib/api';

interface FilingTypePickerProps {
  countryId: string;
  selectedTypes: string[];
  onCountryChange: (countryId: string) => void;
  onTypesChange: (types: string[]) => void;
  compact?: boolean;
}

export function FilingTypePicker({ countryId, selectedTypes, onCountryChange, onTypesChange, compact = false }: FilingTypePickerProps) {
  const [countries, setCountries] = React.useState<SupportedCountry[]>([]);
  const [filingTypes, setFilingTypes] = React.useState<FilingType[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [retryKey, setRetryKey] = React.useState(0);
  const countryChangeRef = React.useRef(onCountryChange);

  React.useEffect(() => {
    countryChangeRef.current = onCountryChange;
  }, [onCountryChange]);

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const loadedCountries = await fetchSupportedCountries();
        if (!alive) return;
        setCountries(loadedCountries);
        const selected = loadedCountries.find(country => country.id === countryId) || loadedCountries[0];
        if (!selected) throw new Error('No supported countries are configured yet.');
        if (selected.id !== countryId) countryChangeRef.current(selected.id);
        const loadedFilingTypes = await fetchFilingTypes(selected.id);
        if (!alive) return;
        setFilingTypes(loadedFilingTypes);
        if (!loadedFilingTypes.length) setError('No filing types are configured for this country yet.');
      } catch (err: any) {
        if (alive && err.name !== 'AbortError') setError(err.message || 'Could not load filing types.');
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => { alive = false; controller.abort(); };
  }, [countryId, retryKey]);

  const toggle = (type: FilingType, checked: boolean) => {
    onTypesChange(checked
      ? Array.from(new Set([...selectedTypes, type.code]))
      : selectedTypes.filter(value => value !== type.code));
  };

  return (
    <div className={compact ? 'filing-picker compact' : 'filing-picker'}>
      <label className="f">Country
        <select className="modal-input" value={countryId} onChange={event => { onCountryChange(event.target.value); onTypesChange([]); }} disabled={loading && !countries.length}>
          {!countries.length && <option value="">Loading countries…</option>}
          {countries.map(country => <option key={country.id} value={country.id}>{country.country_name} ({country.country_code})</option>)}
        </select>
      </label>
      <div className="f client-edit-label">Filing services</div>
      {loading ? <div className="filing-types-skeleton" aria-label="Loading filing types" aria-busy="true">
        <span className="filing-skeleton-caption">Loading latest services</span>
        <div className="filing-skeleton-pills">
          <i /><i /><i /><i /><i /><i />
        </div>
      </div> : error ? <div className="ob-error">{error}<button className="btn sm gh" style={{ marginLeft: 8 }} onClick={() => setRetryKey(value => value + 1)}>Retry</button></div> : (
        <div className="client-edit-filings">
          {filingTypes.map(type => <label key={type.id} className={'client-edit-check' + (selectedTypes.includes(type.code) ? ' selected' : '')} title={type.description || type.name}>
            <input type="checkbox" checked={selectedTypes.includes(type.code)} onChange={event => toggle(type, event.target.checked)} />
            {type.code}
          </label>)}
        </div>
      )}
    </div>
  );
}
