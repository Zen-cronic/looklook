/**
 * The "Look twice" iPhone Shortcut, as the Shortcuts app stores it. It runs
 * from the share sheet with a link, a web page, text or an image:
 *
 *   Get URLs from Input (Shortcut Input)
 *   If URLs has any value
 *     Text  <base>/s?u=<URLs>
 *     Open URLs
 *   Otherwise
 *     Convert Image (Shortcut Input) to JPEG
 *     Get Contents of URL  POST <base>/api/share?reply=url, body: File = Converted Image
 *     Open URLs
 *   End If
 *
 * `/s` takes the link as it is (no encoding step), and `/api/share?reply=url`
 * answers with the page to open as plain text. Converting to JPEG also turns
 * an iPhone HEIC photo into something the server reads; a large image is
 * scaled down on the server.
 */

const ids = {
  urls: "6C1F0A1E-3B52-4C1B-9E0A-1D2B3C4D5E01",
  ifGroup: "6C1F0A1E-3B52-4C1B-9E0A-1D2B3C4D5E02",
  text: "6C1F0A1E-3B52-4C1B-9E0A-1D2B3C4D5E03",
  convert: "6C1F0A1E-3B52-4C1B-9E0A-1D2B3C4D5E04",
  download: "6C1F0A1E-3B52-4C1B-9E0A-1D2B3C4D5E05",
  open1: "6C1F0A1E-3B52-4C1B-9E0A-1D2B3C4D5E06",
  open2: "6C1F0A1E-3B52-4C1B-9E0A-1D2B3C4D5E07",
  endIf: "6C1F0A1E-3B52-4C1B-9E0A-1D2B3C4D5E08",
};

const output = (uuid: string, name: string) => ({ OutputUUID: uuid, Type: "ActionOutput", OutputName: name });
const attachment = (value: Record<string, unknown>) => ({ Value: value, WFSerializationType: "WFTextTokenAttachment" });
const shortcutInput = attachment({ Type: "ExtensionInput" });
/** A text field: `before`, then the variable, then nothing (U+FFFC marks where the variable goes). */
const textWith = (before: string, variable: Record<string, unknown>) => ({
  Value: { string: `${before}￼`, attachmentsByRange: { [`{${before.length}, 1}`]: variable } },
  WFSerializationType: "WFTextTokenString",
});
const plainText = (s: string) => ({ Value: { string: s, attachmentsByRange: {} }, WFSerializationType: "WFTextTokenString" });

export function shortcutWorkflow(base: string) {
  const b = base.replace(/\/$/, "");
  const actions = [
    { WFWorkflowActionIdentifier: "is.workflow.actions.detect.link", WFWorkflowActionParameters: { WFInput: shortcutInput, UUID: ids.urls } },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: {
        GroupingIdentifier: ids.ifGroup,
        WFControlFlowMode: 0,
        WFCondition: 100,
        WFInput: { Type: "Variable", Variable: attachment(output(ids.urls, "URLs")) },
      },
    },
    { WFWorkflowActionIdentifier: "is.workflow.actions.gettext", WFWorkflowActionParameters: { WFTextActionText: textWith(`${b}/s?u=`, output(ids.urls, "URLs")), UUID: ids.text } },
    { WFWorkflowActionIdentifier: "is.workflow.actions.openurl", WFWorkflowActionParameters: { WFInput: attachment(output(ids.text, "Text")), UUID: ids.open1 } },
    { WFWorkflowActionIdentifier: "is.workflow.actions.conditional", WFWorkflowActionParameters: { GroupingIdentifier: ids.ifGroup, WFControlFlowMode: 1 } },
    { WFWorkflowActionIdentifier: "is.workflow.actions.image.convert", WFWorkflowActionParameters: { WFInput: shortcutInput, WFImageFormat: "JPEG", WFImageCompressionQuality: 0.8, WFImagePreserveMetadata: false, UUID: ids.convert } },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.downloadurl",
      WFWorkflowActionParameters: {
        WFURL: plainText(`${b}/api/share?reply=url`),
        WFHTTPMethod: "POST",
        WFHTTPBodyType: "File",
        WFRequestVariable: attachment(output(ids.convert, "Converted Image")),
        ShowHeaders: false,
        UUID: ids.download,
      },
    },
    { WFWorkflowActionIdentifier: "is.workflow.actions.openurl", WFWorkflowActionParameters: { WFInput: attachment(output(ids.download, "Contents of URL")), UUID: ids.open2 } },
    { WFWorkflowActionIdentifier: "is.workflow.actions.conditional", WFWorkflowActionParameters: { GroupingIdentifier: ids.ifGroup, WFControlFlowMode: 2, UUID: ids.endIf } },
  ];
  return {
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowClientVersion: "4018.0.4",
    WFWorkflowIcon: { WFWorkflowIconStartColor: 463140863, WFWorkflowIconGlyphNumber: 59511 },
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: true,
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: ["ActionExtension"],
    WFQuickActionSurfaces: [],
    WFWorkflowInputContentItemClasses: ["WFImageContentItem", "WFSafariWebPageContentItem", "WFURLContentItem", "WFStringContentItem"],
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowActions: actions,
  };
}
