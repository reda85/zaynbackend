import React from 'react'
import { Text, View } from '@react-pdf/renderer'

const renderTextNode = (node, fontFamily, baseStyle = {}) => {
  if (node.type !== 'text') return null
  const text  = node.text || ''
  const marks = node.marks || []

  let style = { ...baseStyle, fontFamily }
  marks.forEach((mark) => {
    if (mark.type === 'bold')      style.fontWeight     = 'bold'
    if (mark.type === 'italic')    style.fontStyle      = 'italic'
    if (mark.type === 'underline') style.textDecoration = 'underline'
  })

  return <Text style={style}>{text}</Text>
}

const renderInlineContent = (content, fontFamily, baseStyle = {}) => {
  if (!content || !Array.isArray(content)) return null
  return content.map((node, i) => (
    <React.Fragment key={i}>{renderTextNode(node, fontFamily, baseStyle)}</React.Fragment>
  ))
}

const getTextAlign = (node) => {
  const align = node.attrs?.textAlign
  if (align === 'center') return 'center'
  if (align === 'right')  return 'right'
  return 'left'
}

const renderBlockNode = (node, fontFamily, primaryColor, depth = 0) => {
  if (!node) return null

  switch (node.type) {

    case 'paragraph': {
      const align = getTextAlign(node)
      if (!node.content || node.content.length === 0) {
        return <View style={{ height: 6 }} />
      }
      return (
        <View style={{ marginBottom: 6 }}>
          <Text style={{ fontSize: 10, lineHeight: 1.5, color: '#292524', textAlign: align, fontFamily }}>
            {renderInlineContent(node.content, fontFamily)}
          </Text>
        </View>
      )
    }

    case 'heading': {
      const level = node.attrs?.level || 1
      const sizeMap = { 1: 16, 2: 13, 3: 11 }
      const align = getTextAlign(node)
      return (
        <View style={{ marginTop: 10, marginBottom: 6 }}>
          <Text style={{ fontSize: sizeMap[level] || 11, fontWeight: 'bold', color: '#1c1917', textAlign: align, fontFamily }}>
            {renderInlineContent(node.content, fontFamily)}
          </Text>
        </View>
      )
    }

    case 'bulletList': {
      return (
        <View style={{ marginVertical: 4, paddingLeft: 12 + depth * 12 }}>
          {(node.content || []).map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 }}>
              <View style={{ width: 4, height: 4, borderRadius: 9999, backgroundColor: primaryColor, marginTop: 6, marginRight: 8, flexShrink: 0 }} />
              <View style={{ flex: 1 }}>
                {(item.content || []).map((child, ci) => (
                  <React.Fragment key={ci}>
                    {renderBlockNode(child, fontFamily, primaryColor, depth + 1)}
                  </React.Fragment>
                ))}
              </View>
            </View>
          ))}
        </View>
      )
    }

    case 'orderedList': {
      const startIndex = node.attrs?.start || 1
      return (
        <View style={{ marginVertical: 4, paddingLeft: 12 + depth * 12 }}>
          {(node.content || []).map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 }}>
              <Text style={{ fontSize: 10, color: primaryColor, fontWeight: 'bold', marginRight: 6, minWidth: 16, fontFamily }}>
                {startIndex + i}.
              </Text>
              <View style={{ flex: 1 }}>
                {(item.content || []).map((child, ci) => (
                  <React.Fragment key={ci}>
                    {renderBlockNode(child, fontFamily, primaryColor, depth + 1)}
                  </React.Fragment>
                ))}
              </View>
            </View>
          ))}
        </View>
      )
    }

    case 'listItem': {
      return (
        <>
          {(node.content || []).map((child, i) => (
            <React.Fragment key={i}>
              {renderBlockNode(child, fontFamily, primaryColor, depth)}
            </React.Fragment>
          ))}
        </>
      )
    }

    case 'table': {
      const rows = node.content || []
      return (
        <View style={{ marginVertical: 8, borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#d6d3d1' }} wrap={false}>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row' }}>
              {(row.content || []).map((cell, ci) => {
                const isHeader = cell.type === 'tableHeader'
                return (
                  <View
                    key={ci}
                    style={{
                      flex: 1,
                      padding: 5,
                      borderRightWidth: 1,
                      borderBottomWidth: 1,
                      borderColor: '#d6d3d1',
                      backgroundColor: isHeader ? '#f5f5f4' : 'white',
                      minWidth: 50,
                    }}
                  >
                    {(cell.content || []).map((cellChild, cci) => {
                      if (cellChild.type === 'paragraph') {
                        const align = getTextAlign(cellChild)
                        return (
                          <Text
                            key={cci}
                            style={{
                              fontSize: 9,
                              fontWeight: isHeader ? 'bold' : 'normal',
                              color: isHeader ? '#1c1917' : '#44403c',
                              textAlign: align,
                              fontFamily,
                            }}
                          >
                            {renderInlineContent(cellChild.content, fontFamily)}
                          </Text>
                        )
                      }
                      return (
                        <React.Fragment key={cci}>
                          {renderBlockNode(cellChild, fontFamily, primaryColor, depth)}
                        </React.Fragment>
                      )
                    })}
                  </View>
                )
              })}
            </View>
          ))}
        </View>
      )
    }

    case 'hardBreak':
      return <Text style={{ fontFamily }}>{'\n'}</Text>

    default:
      if (node.content) {
        return (
          <>
            {node.content.map((child, i) => (
              <React.Fragment key={i}>
                {renderBlockNode(child, fontFamily, primaryColor, depth)}
              </React.Fragment>
            ))}
          </>
        )
      }
      return null
  }
}

export default function RichTextPdfRenderer({ content, fontFamily = 'Helvetica', primaryColor = '#44403c' }) {
  if (!content || !content.content || content.content.length === 0) {
    return null
  }
  return (
    <View>
      {content.content.map((node, i) => (
        <React.Fragment key={i}>
          {renderBlockNode(node, fontFamily, primaryColor)}
        </React.Fragment>
      ))}
    </View>
  )
}