
const fs = require('fs');
let code = fs.readFileSync('src/components/LayoutPreviewBoard.tsx', 'utf8');

code = code.replace('import { CropEditorModal } from './CropEditorModal';', 'import { CropEditorModal } from './CropEditorModal';\nimport { useStudio } from './StudioContext';');

code = code.replace(/interface CropTarget \{\s*pageId: string;\s*slotId: string;\s*\}/g, '');

const stateRegex = /const \[cropTarget, setCropTarget\] = useState<CropTarget \\| null>\\(null\\);\\s*/;
code = code.replace(stateRegex, 'const { cropTarget, onOpenCropEditor: handleCropTargetOpen, onCloseCropEditor: handleCropTargetClose, onUpdateSlotAssignment } = useStudio();\n  ');

const handlerOpenRegex = /const handleCropTargetOpen = useCallback\\(\\(pageId: string, slotId: string\\) => \\{\\s*setCropTarget\\(\\{ pageId, slotId \\}\\);\\s*\\}, \\[\\]\\);\\s*/;
code = code.replace(handlerOpenRegex, '');

const handlerCloseRegex = /const handleCropTargetClose = useCallback\\(\\(\\) => \\{\\s*setCropTarget\\(null\\);\\s*\\}, \\[\\]\\);\\s*/;
code = code.replace(handlerCloseRegex, '');

const applyRegex = /onApply=\{\\(changes\\) => \\{\\s*\\/\\/ onUpdateSlotAssignment\\(cropPage\\.id, cropSlot\\.id, changes\\);\\s*\\}\\}/;
code = code.replace(applyRegex, 'onApply={(changes) => { onUpdateSlotAssignment(cropPage.id, cropSlot.id, changes); }}');

fs.writeFileSync('src/components/LayoutPreviewBoard.tsx', code);

