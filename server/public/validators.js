// Small browser-side validation helpers. Keep business/security validation on the server.
(function(root){
  var EXTENSIONS=['docx','pdf','xlsx'];
  var MIMES=[
    'application/pdf',
    'application/x-pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  function extensionOf(name){
    var text=String(name||'');
    var dot=text.lastIndexOf('.');
    return dot<0?'':text.slice(dot+1).toLowerCase();
  }
  function isSdsFile(file){
    if(!file)return false;
    return EXTENSIONS.indexOf(extensionOf(file.name))!==-1 ||
      MIMES.indexOf(String(file.type||'').trim().toLowerCase())!==-1;
  }
  function sdsFileError(file){
    if(!file)return 'Select a Word (.docx), PDF (.pdf), or Excel (.xlsx) SDS file.';
    if(isSdsFile(file))return '';
    var name=String(file.name||'unnamed file');
    var extension=extensionOf(name);
    var type=String(file.type||'').trim();
    var detected=extension?'.'+extension:'no file extension';
    if(type)detected+='; browser type: '+type;
    return 'File "'+name+'" was not accepted ('+detected+'). Use .docx, .pdf, or .xlsx. If the document is valid, export it to one of those formats and retry.';
  }
  function isCas(value){
    return /^[0-9]{2,7}-[0-9]{2}-[0-9]$/.test(String(value||'').trim());
  }
  root.EWASCO_VALIDATE={extensionOf,isSdsFile,sdsFileError,isCas};
})(globalThis);
