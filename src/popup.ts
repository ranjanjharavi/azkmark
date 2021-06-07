// Popup script for the Azkmark extension
const openLibraryButton = document.querySelector<HTMLButtonElement>("#open-library");
const feedback = document.querySelector<HTMLParagraphElement>("#feedback");

if (!openLibraryButton || !feedback) {
  throw new Error("The popup is missing its library button or feedback element.");
}

const openLibraryButtonElement = openLibraryButton;
const feedbackElement = feedback;

openLibraryButtonElement.addEventListener("click", () => {
  openLibraryButtonElement.disabled = true;
  feedbackElement.hidden = true;

  const libraryUrl = chrome.runtime.getURL("library.html");
  chrome.tabs.create({ url: libraryUrl }, () => {
    const lastError = chrome.runtime.lastError;

    if (lastError) {
      console.error("Could not open the bookmark library.", lastError.message);
      feedbackElement.textContent = "Could not open the library. Reload the extension and try again.";
      feedbackElement.hidden = false;
    }

    openLibraryButtonElement.disabled = false;
  });
});
