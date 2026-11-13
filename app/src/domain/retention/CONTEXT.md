# Retention rule evaluation

Pure bounded newest-first windows, at most100 physical facts. Carries exact checked
completed count/logical debt prefix; unknown completed bytes disables storage-based
selection beyond that point. Protected completed rows still consume count/bytes.
Manual policy selects none; age uses immutable request time and never selects active
work. Rule precedence age/count/storage only chooses the reported reason; rules union.
No scope/settings lookup, persistence, eligibility grant, native work or quota credit.
The metadata owner must capture facts, freeze selection and revalidate before Begin.
