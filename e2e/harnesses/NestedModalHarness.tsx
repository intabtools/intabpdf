import { useState } from 'react';
import ModalDialog from '../../src/components/ModalDialog';

export default function NestedModalHarness() {
  const [openA, setOpenA] = useState(false);
  const [openB, setOpenB] = useState(false);

  return (
    <div>
      <button id="trigger-open-a" type="button" onClick={() => setOpenA(true)}>
        Open Modal A
      </button>

      <ModalDialog
        isOpen={openA}
        onClose={() => setOpenA(false)}
        title="Modal A Title"
        description="Modal A Description"
      >
        <div>
          <button
            id="btn-inside-a-open-b"
            type="button"
            onClick={() => setOpenB(true)}
          >
            Open Nested Modal B
          </button>

          <ModalDialog
            isOpen={openB}
            onClose={() => setOpenB(false)}
            title="Modal B Title"
            description="Modal B Description"
          >
            <button
              id="btn-inside-b-close"
              type="button"
              onClick={() => setOpenB(false)}
            >
              Done B
            </button>
          </ModalDialog>
        </div>
      </ModalDialog>
    </div>
  );
}
