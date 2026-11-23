import {useState,useRef,useEffect,useCallback} from "react";
function searchShortcut(e: KeyboardEvent) {
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
}
export function useShellSearch(canSearch: boolean) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchButton.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (canSearch && searchShortcut(e)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSearch]);
  return { searchOpen, setSearchOpen, searchButton, closeSearch };
}
