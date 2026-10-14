# ATX Transformation Mapping Components

## Overview

This directory contains React components for mapping discovered migration patterns to ATX (AWS Transformation Executor) transformation definitions.

## Components

### ATXDropdown

A dropdown component for selecting an ATX transformation for a specific application.

**Props:**
- `patternId` (string): Pattern identifier
- `applicationId` (string): Application identifier
- `applicationName` (string): Application name
- `strategy` (string): Migration strategy
- `transformationInstructions` (string): Detailed transformation instructions
- `atxTransformations` (ATXTransformation[]): Available ATX transformations
- `onSelect` (function): Callback when ATX is selected
- `disabled` (boolean, optional): Disable the dropdown
- `errorText` (string, optional): Validation error message

**Usage:**
```tsx
<ATXDropdown
  patternId="PATTERN_ABC123"
  applicationId="app-001"
  applicationName="Customer Portal"
  strategy="Runtime Major Upgrade"
  transformationInstructions="Upgrade Java from 8 to 17..."
  atxTransformations={atxTransformations}
  onSelect={(mapping) => console.log('Selected:', mapping)}
/>
```

### ATXMappingPanel

A panel component that displays all patterns and their applications with ATX dropdowns for mapping.

**Props:**
- `waveId` (string): Wave identifier
- `patterns` (Pattern[]): List of discovered patterns
- `onMappingsSubmitted` (function, optional): Callback after successful submission

**Features:**
- Automatically loads ATX transformations from backend
- Displays patterns in expandable sections
- Shows validation errors for missing selections
- Handles submission with loading states
- Shows success/error messages
- Tracks mapping progress (X of Y mapped)

**Usage:**
```tsx
<ATXMappingPanel
  waveId="wave-001"
  patterns={patterns}
  onMappingsSubmitted={() => console.log('Mappings submitted!')}
/>
```

### PatternDiscovery (Updated)

The main pattern discovery component now includes a tabbed interface with:
1. **Patterns Tab**: View and analyze discovered patterns
2. **ATX Mapping Tab**: Map patterns to ATX transformations

**New Features:**
- Tab navigation between patterns and ATX mapping
- Integrated ATX mapping workflow
- Automatic refresh after mapping submission

## Data Flow

```
1. User selects wave
   ↓
2. Load patterns (existing)
   ↓
3. User switches to "ATX Mapping" tab
   ↓
4. ATXMappingPanel loads ATX transformations
   ↓
5. User selects ATX for each application
   ↓
6. User clicks "Submit Mappings"
   ↓
7. Validation checks all applications have ATX
   ↓
8. Submit to backend API
   ↓
9. Show success/error message
   ↓
10. Optionally refresh patterns
```

## API Integration

### Get ATX Transformations

```typescript
import { getATXTransformations } from '../../services/patterns'

const response = await getATXTransformations()
if (response.success) {
  console.log(response.transformations)
}
```

### Submit ATX Mappings

```typescript
import { submitATXMappings } from '../../services/patterns'

const mappings = [
  {
    pattern_id: 'PATTERN_ABC123',
    application_id: 'app-001',
    application_name: 'Customer Portal',
    strategy: 'Runtime Major Upgrade',
    transformation_instructions: 'Upgrade Java...',
    atx_name: 'AWS/java-version-upgrade',
    atx_description: 'Upgrade Java applications...'
  }
]

const response = await submitATXMappings('wave-001', mappings)
if (response.success) {
  console.log(`Updated ${response.updated_count} mappings`)
}
```

## State Management

### ATXMappingPanel State

- `atxTransformations`: List of available ATX transformations
- `mappings`: Map of selected mappings (key: `${pattern_id}-${application_id}`)
- `loading`: Loading ATX transformations
- `submitting`: Submitting mappings
- `error`: Error message
- `success`: Success message
- `validationErrors`: Map of validation errors per application

### PatternDiscovery State

- `activeTabId`: Current active tab ('patterns' or 'atx-mapping')
- All existing pattern discovery state

## Error Handling

### No ATX File Uploaded

Shows a warning alert with instructions to upload ATX file in Notes section.

### Validation Errors

- Highlights applications without ATX selection
- Shows error message at top of panel
- Prevents submission until all applications have ATX

### API Errors

- Network errors
- Backend validation errors
- Partial success scenarios (some mappings failed)

## Styling

Uses AWS Cloudscape Design System components:
- Container
- Header
- Table
- Select (with filtering)
- FormField
- Alert
- Button
- Spinner
- ExpandableSection
- StatusIndicator
- Tabs

## Testing

Run tests:
```bash
npm test -- ATXMappingPanel.test.tsx
```

Test coverage:
- Loading states
- No ATX file scenario
- Pattern rendering
- Validation
- Submission
- Error handling

## Future Enhancements

1. **Bulk Operations**
   - "Select All" to apply same ATX to all applications
   - "Clear All" to reset selections

2. **ATX Recommendations**
   - Suggest ATX transformations based on pattern analysis
   - Auto-select recommended ATX

3. **Mapping History**
   - View previous mappings
   - Edit existing mappings
   - Audit trail

4. **Advanced Filtering**
   - Filter patterns by strategy
   - Search ATX transformations
   - Group by pattern type

5. **Export/Import**
   - Export mappings to CSV
   - Import mappings from file
   - Bulk edit in spreadsheet

## Troubleshooting

### ATX transformations not loading

**Problem**: Dropdown shows "No ATX file uploaded"

**Solution**: 
1. Go to Notes page
2. Upload ATX JSON file with note_type="ATX"
3. Return to Pattern Discovery and refresh

### Submit button disabled

**Problem**: Cannot click Submit Mappings button

**Causes**:
- No mappings selected (select ATX for at least one application)
- Currently submitting (wait for completion)

### Validation errors

**Problem**: "Please select ATX transformation for all applications"

**Solution**: Ensure every application in every pattern has an ATX transformation selected

### API errors

**Problem**: "Failed to submit ATX mappings"

**Causes**:
- Network connectivity issues
- Backend service down
- Invalid ATX name (shouldn't happen with dropdown)
- DynamoDB write failures

**Solution**: Check browser console for detailed error, retry submission

## Support

For issues or questions:
- Check backend logs for API errors
- Review browser console for frontend errors
- Verify ATX file is uploaded correctly
- Ensure wave has patterns discovered
