// Optional library preferences stay separate from bookmark storage and backups
window.azkmarkLibraryPreference = ({ key, fallback, values, apply }) => {
  let value = fallback;
  let controls = [];

  function update(next) {
    value = values.includes(next) ? next : fallback;
    controls.forEach((control) => {
      control.value = value;
    });
    apply(value);
  }

  let stored;
  try {
    stored = localStorage.getItem(key);
  } catch {
    // Blocked storage must not prevent browsing
  }
  update(stored);

  window.addEventListener("storage", (event) => {
    try {
      if (event.storageArea !== localStorage) {
        return;
      }
    } catch {
      return;
    }
    if (event.key === key || event.key === null) {
      update(event.newValue);
    }
  });

  return (inputs) => {
    controls = Array.from(inputs);
    update(value);
    controls.forEach((control) => {
      control.addEventListener("change", () => {
        update(control.value);
        try {
          if (value === fallback) {
            localStorage.removeItem(key);
          } else {
            localStorage.setItem(key, value);
          }
        } catch {
          // The current tab remains usable without persistence
        }
      });
    });
  };
};
