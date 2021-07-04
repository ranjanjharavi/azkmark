interface Window {
  azkmarkLibraryPreference<T extends string>(options: {
    key: string;
    fallback: T;
    values: readonly T[];
    apply: (value: T) => void;
  }): (controls: readonly (HTMLInputElement | HTMLSelectElement)[]) => void;
}
