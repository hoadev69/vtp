export function isDialogBackdropClick(event) {
    if (event.target !== event.currentTarget) return false;

    const { bottom, left, right, top } = event.currentTarget.getBoundingClientRect();
    return event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom;
}
