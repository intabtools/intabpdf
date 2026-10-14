/*
- Declare types for the custom window api.
- Used to recieve pdfs when opened by the electron app.

*/

declare global {
    interface Window {
        intab?: {
            onOpenPdf(file: {name: string; byte: Uint8Array}): () => void;
        };
    }
}