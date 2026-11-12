// jsdom gaps used by the UI (scrolling helpers, object URLs for exports).
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function scrollIntoView() {};
window.scrollTo = () => {};
if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:argolet-test';
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
