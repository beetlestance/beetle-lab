export type NoTaskReceiptOperation={readonly kind:'noTaskReceiptRead'|'noTaskReceiptCommit';readonly json:string};
export function noTaskReceiptOperation(input:{readonly kind:string}):input is NoTaskReceiptOperation{
 return input.kind==='noTaskReceiptRead'||input.kind==='noTaskReceiptCommit';
}
