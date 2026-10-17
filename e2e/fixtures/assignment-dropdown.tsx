import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MultiSelectDropdown } from "../../src/components/ui/MultiSelectDropdown";
import "../../src/styles.css";

export function AssignmentDropdownFixture() {
  const [classes, setClasses] = useState<string[]>([]);
  const [courses, setCourses] = useState<string[]>([]);
  return <main style={{ width: "min(100%, 520px)", padding: 16 }}>
    <MultiSelectDropdown label="Cours" inline options={[{ value: "math", label: "Mathématiques" }]} values={courses} onChange={setCourses} />
    <label>Nouveau cours<input className="input" aria-label="Nouveau cours" /></label>
    <MultiSelectDropdown label="Classes" inline options={[{ value: "one", label: "1ère" }, { value: "two", label: "2ème" }, { value: "three", label: "3ème" }]} values={classes} onChange={setClasses} />
    <label>Nombre de périodes hebdomadaires<input className="input" type="number" aria-label="Nombre de périodes hebdomadaires" /></label>
  </main>;
}

createRoot(document.getElementById("root")!).render(<AssignmentDropdownFixture />);
