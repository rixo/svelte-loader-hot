<script context="module">
  const posixify = file => file.replace(/[/\\]/g, '/')

  const getBaseName = id => id.split('/').pop().split('.').shift()

  const capitalize = str => str[0].toUpperCase() + str.slice(1)

  const getFriendlyName = id => capitalize(getBaseName(posixify(id)))

  const getDebugName = id => `<${getFriendlyName(id)}>`
</script>

<script>
  const hmrError = JSON.parse(
    '%hmr_error%'
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
  )
  const { filename, message } = hmrError
  const debugName = getDebugName(filename)
</script>

<style>
  .title-ct {
    margin-bottom: 5px;
  }
  .title-ct * {
    display: inline;
  }
  .title {
    color: red;
    font-size: 16px;
    margin: 0;
    text-align: center;
  }
  .title span {
    font-weight: normal;
    font-size: 24px;
    position: relative;
    top: 3px;
    line-height: 0;
  }
  .filename {
    text-align: left;
    text-align: center;
    font-size: 12px;
  }
  section {
    border: 4px solid red;
    padding: 10px;
    background-color: #fff6f6;
    box-shadow: inset 0 1px 8px 1px #faa;
    overflow: auto;
  }
  pre {
    background-color: #eee;
    text-align: left;
    padding: 5px;
    margin: 0;
    font-size: 12px;
    line-height: 1em;
  }
</style>

<section>
  <div class="title-ct">
    <h1 class="title"><span>☠</span> {debugName} <span>☠</span></h1>
    <div class="filename">in {filename}</div>
  </div>
  <pre>{message}</pre>
</section>
